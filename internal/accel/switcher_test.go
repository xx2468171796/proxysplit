package accel

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeRelay 只实现打招呼和健康检查（签名用给定私钥）
func fakeRelay(t *testing.T, key ed25519.PrivateKey, up *atomic.Bool) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				if !up.Load() {
					return
				}
				br := bufio.NewReader(c)
				for {
					req, err := readRequest(br)
					if err != nil {
						return
					}
					body := "ok"
					if strings.HasPrefix(req.target, "/__accel/hello?nonce=") {
						nonce := strings.TrimPrefix(req.target, "/__accel/hello?nonce=")
						sig := base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte("accel-hello-v1|fake|"+nonce)))
						body = fmt.Sprintf(`{"v":1,"relay":"fake","sig":%q}`, sig)
					}
					fmt.Fprintf(c, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n%s", len(body), body)
				}
			}(c)
		}
	}()
	return ln.Addr().String()
}

type fakeEnv struct {
	socks, line  atomic.Value
	off, autoOff atomic.Bool
}

func (f *fakeEnv) env() Env {
	return Env{
		Socks:    func() string { return f.socks.Load().(string) },
		Line:     func() string { return f.line.Load().(string) },
		Settings: func() (bool, bool) { return f.off.Load(), f.autoOff.Load() },
	}
}

func setup(t *testing.T, signer ed25519.PrivateKey, trusted ed25519.PublicKey) (*Switcher, *fakeEnv, *atomic.Bool, *ClaudeSettings) {
	up := &atomic.Bool{}
	up.Store(true)
	addr := fakeRelay(t, signer, up)
	eng := New(Config{
		ListenAddr: "127.0.0.1:0",
		Token:      func() (string, error) { return "axt1.test", nil },
		RelayHost:  "accel.powervpn.internal",
		HelloKeys:  []ed25519.PublicKey{trusted},
		Dial:       func(string, uint16) (net.Conn, error) { return net.Dial("tcp", addr) },
	})
	if _, err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Close)
	cfg := newCfg(t)
	fe := &fakeEnv{}
	fe.socks.Store("127.0.0.1:1")
	fe.line.Store("node-a|proxy")
	return NewSwitcher(eng, cfg, fe.env(), t.Logf), fe, up, cfg
}

func TestSwitcherAutoEncodeThenDropAfterFailures(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	sw, _, up, cfg := setup(t, priv, pub)
	sw.tick()
	if st := sw.State(); st.Mode != ModeEncode || st.Relay != "fake" {
		t.Fatalf("验签通过应自动切到编码模式：%+v", st)
	}
	if !cfg.Active("http://" + sw.eng.Addr()) {
		t.Fatal("Claude Code 配置应指向本机编码端")
	}
	up.Store(false) // 中继挂了
	sw.Kick()
	sw.tick()
	if sw.State().Mode != ModeEncode {
		t.Fatal("一次失败不应立刻退回（防抖）")
	}
	sw.Kick()
	sw.tick()
	if st := sw.State(); st.Mode != ModeOfficial {
		t.Fatalf("连续失败应退回官方默认：%+v", st)
	}
	if cfg.Active("http://" + sw.eng.Addr()) {
		t.Fatal("退回官方后配置应已还原")
	}
}

func TestSwitcherRejectsForeignLanding(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(nil)
	_, other, _ := ed25519.GenerateKey(nil)
	sw, _, _, _ := setup(t, other, pub) // 签名的不是我们的私钥
	sw.tick()
	if st := sw.State(); st.Mode != ModeOfficial || !strings.Contains(st.Reason, "不是我们的节点") {
		t.Fatalf("签名验不过应留在官方默认：%+v", st)
	}
}

func TestSwitcherManualOfficialUntilLineChanges(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	sw, fe, _, _ := setup(t, priv, pub)
	sw.tick()
	sw.SetManual(ModeOfficial)
	sw.tick()
	if sw.State().Mode != ModeOfficial {
		t.Fatal("手动恢复官方后应是官方默认")
	}
	sw.Kick()
	sw.tick()
	if sw.State().Mode != ModeOfficial {
		t.Fatal("同一条线路上自动不应把手动选择改回去")
	}
	fe.line.Store("node-b|proxy") // 换线路
	sw.tick()
	if st := sw.State(); st.Mode != ModeEncode || st.Manual != "" {
		t.Fatalf("换线路后回到自动：%+v", st)
	}
}

func TestSwitcherOffOrProxyDownMeansOfficial(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	sw, fe, _, _ := setup(t, priv, pub)
	sw.tick()
	fe.socks.Store("")
	sw.tick()
	if st := sw.State(); st.Mode != ModeOfficial || st.Reason != "代理未开启" {
		t.Fatalf("代理关了应回官方默认：%+v", st)
	}
	fe.socks.Store("127.0.0.1:1")
	fe.off.Store(true)
	sw.tick()
	if st := sw.State(); st.Mode != ModeOfficial || st.Enabled {
		t.Fatalf("功能关闭应回官方默认：%+v", st)
	}
	fe.off.Store(false)
	fe.autoOff.Store(true)
	sw.tick()
	if sw.State().Mode != ModeOfficial {
		t.Fatal("自动切换关了且没手动选，应留在官方默认")
	}
	sw.SetManual(ModeEncode)
	sw.tick()
	if sw.State().Mode != ModeEncode {
		t.Fatal("自动关了也能手动切编码模式")
	}
}
