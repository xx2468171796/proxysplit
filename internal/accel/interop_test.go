//go:build interop

package accel

// 与真实 Rust 中继（sub2api 仓 accel/，0.5+）的互通测试。在编译机上跑：
//
//	ACCEL_INTEROP_RELAY=127.0.0.1:8896 ACCEL_INTEROP_SHARED=<中继共享口令> \
//	ACCEL_INTEROP_USER_SEED=<用户令牌私钥种子 base64url> ACCEL_INTEROP_ID_PUB=<落地身份公钥 base64url> \
//	./accel.test -test.run Interop -test.v
//
// 中继连真官方：没有凭据时官方回 401，但中继已按 sha256 逐字节还原并校验了请求体——这里验的是编码 / 流 / 续传协议本身。

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func b64(s string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		panic(err)
	}
	return b
}

func userToken(seed []byte, sub string, exp int64) string {
	key := ed25519.NewKeyFromSeed(seed)
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"sub":%q,"exp":%d}`, sub, exp)))
	signed := "axt1." + payload
	return signed + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(signed)))
}

func interopEngine(t *testing.T, relay, token string) *Engine {
	host, port, _ := net.SplitHostPort(relay)
	e := New(Config{
		ListenAddr: "127.0.0.1:0",
		Token:      func() (string, error) { return token, nil },
		RelayHost:  "accel.powervpn.internal",
		HelloKeys:  []ed25519.PublicKey{b64(os.Getenv("ACCEL_INTEROP_ID_PUB"))},
		Logf:       t.Logf,
		Dial: func(h string, p uint16) (net.Conn, error) {
			if h == "accel.powervpn.internal" {
				if p == 8896 {
					return net.Dial("tcp", net.JoinHostPort(host, port))
				}
				return net.Dial("tcp", net.JoinHostPort(host, fmt.Sprint(p)))
			}
			return net.Dial("tcp", net.JoinHostPort(h, fmt.Sprint(p)))
		},
	})
	if _, err := e.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return e
}

func post(t *testing.T, addr string, body []byte) (int, string) {
	req, _ := http.NewRequest("POST", "http://"+addr+"/v1/messages?beta=true", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Anthropic-Version", "2023-06-01")
	req.Header.Set("User-Agent", "claude-cli/interop-test")
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func TestInteropHelloAndDeltaAcrossTurns(t *testing.T) {
	relay := os.Getenv("ACCEL_INTEROP_RELAY")
	seed := b64(os.Getenv("ACCEL_INTEROP_USER_SEED"))
	e := interopEngine(t, relay, userToken(seed, "interop_a", time.Now().Add(time.Hour).Unix()))
	h, err := e.Hello()
	if err != nil {
		t.Fatalf("打招呼：%v", err)
	}
	t.Logf("落地 %s，往返 %v", h.Relay, h.RTT)
	e.SetUsable(true)
	for turn := 0; turn < 3; turn++ {
		code, resp := post(t, e.Addr(), body(400+turn))
		t.Logf("第 %d 轮：官方 %d %.80q", turn, code, resp)
		if code != 401 && code != 400 && code != 200 {
			t.Fatalf("意外状态 %d", code)
		}
	}
	s := e.Stats()
	t.Logf("统计 %+v", s)
	if s.Relayed != 3 || s.Direct != 0 {
		t.Fatalf("三轮都应经中继：%+v", s)
	}
	// 第 2、3 轮是增量：三轮总帧远小于总请求体
	if s.FrameBytes*20 > s.ReqBytes {
		t.Fatalf("压缩不足：请求 %d 字节，帧 %d 字节", s.ReqBytes, s.FrameBytes)
	}
}

// 租户隔离：B 拿 A 缓存里的基准 sha 发增量，中继必须回 need-base（引用不到别人的缓存）
func TestInteropTenantIsolation(t *testing.T) {
	relay := os.Getenv("ACCEL_INTEROP_RELAY")
	seed := b64(os.Getenv("ACCEL_INTEROP_USER_SEED"))
	a := interopEngine(t, relay, userToken(seed, "iso_a", time.Now().Add(time.Hour).Unix()))
	a.SetUsable(true)
	if _, err := a.Hello(); err != nil {
		t.Fatal(err)
	}
	base := body(300)
	post(t, a.Addr(), base) // A 的中继缓存里有了 base
	cur := body(301)
	sa := sha256Sum(base)
	enc, _ := Encode(base, &sa, cur)
	c, err := net.Dial("tcp", relay)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	head := []byte("POST /v1/messages HTTP/1.1\r\nHost: api.anthropic.com\r\nContent-Length: " + fmt.Sprint(len(cur)) + "\r\n\r\n")
	tokB := userToken(seed, "iso_b", time.Now().Add(time.Hour).Unix())
	fmt.Fprintf(c, "POST /__accel/relay HTTP/1.1\r\nHost: accel-relay\r\nX-Accel-Token: %s\r\nX-Accel-Rid: %s\r\nX-Accel-Head: %d\r\nContent-Length: %d\r\n\r\n", tokB, newRid(), len(head), len(head)+len(enc.Frame))
	c.Write(head)
	c.Write(enc.Frame)
	h, err := readRelayHead(bufio.NewReader(c))
	if err != nil {
		t.Fatal(err)
	}
	if h.stream || h.code != "need-base" {
		t.Fatalf("B 不应引用到 A 的缓存：%+v", h)
	}
}

func TestInteropRejectsBadAndExpiredTokens(t *testing.T) {
	relay := os.Getenv("ACCEL_INTEROP_RELAY")
	seed := b64(os.Getenv("ACCEL_INTEROP_USER_SEED"))
	for name, tok := range map[string]string{
		"过期":  userToken(seed, "x", time.Now().Add(-time.Minute).Unix()),
		"伪造":  userToken(ed25519.NewKeyFromSeed(make([]byte, 32)).Seed(), "x", time.Now().Add(time.Hour).Unix()),
		"空令牌": "",
	} {
		c, err := net.Dial("tcp", relay)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(c, "GET /__accel/resume?rid=abc&offset=0 HTTP/1.1\r\nHost: accel-relay\r\nX-Accel-Token: %s\r\n\r\n", tok)
		h, err := readRelayHead(bufio.NewReader(c))
		c.Close()
		if err != nil || h.code != "auth" {
			t.Fatalf("%s令牌应被拒：%v %+v", name, err, h)
		}
	}
}

// 兜底直连的握手指纹要与 Claude Code（Bun）一致
func TestInteropDirectFingerprint(t *testing.T) {
	e := New(Config{UpstreamHost: "tls.peet.ws", Dial: func(h string, p uint16) (net.Conn, error) {
		return net.Dial("tcp", net.JoinHostPort(h, fmt.Sprint(p)))
	}})
	c, err := e.dialOfficial()
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprint(c, "GET /api/all HTTP/1.1\r\nHost: tls.peet.ws\r\nConnection: close\r\n\r\n")
	raw, _ := io.ReadAll(c)
	_, jsonBody, _ := strings.Cut(string(raw), "\r\n\r\n")
	var r struct {
		TLS struct {
			JA3Hash string `json:"ja3_hash"`
			JA3     string `json:"ja3"`
			JA4     string `json:"ja4"`
			JA4R    string `json:"ja4_r"`
		} `json:"tls"`
	}
	_ = json.Unmarshal([]byte(jsonBody), &r)
	t.Logf("JA3 %s JA4 %s | JA3 原文 %s | JA4_r %s", r.TLS.JA3Hash, r.TLS.JA4, r.TLS.JA3, r.TLS.JA4R)
	// 对照：同一测试站上中继（BoringSSL，复刻 Claude Code）测得的值，由 ACCEL_INTEROP_WANT_JA4 传入
	if want := os.Getenv("ACCEL_INTEROP_WANT_JA4"); want != "" && r.TLS.JA4 != want {
		t.Fatalf("JA4 与中继（BoringSSL）不一致：%s，应为 %s", r.TLS.JA4, want)
	}
}
