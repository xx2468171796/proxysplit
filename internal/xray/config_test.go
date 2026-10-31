package xray

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

const (
	linkXHTTPReality = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.10:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sid=6ba85179e30d4fc2&spx=%2F&type=xhttp&path=%2Fxhttp-a1&mode=auto&extra=%7B%22xmux%22%3A%7B%22maxConcurrency%22%3A%2216-32%22%7D%7D#HK"
	linkXHTTPTLS     = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@cdn.example.com:443?encryption=none&security=tls&sni=cdn.example.com&fp=chrome&alpn=h2&type=xhttp&host=cdn.example.com&path=%2Fsplit&mode=packet-up#US"
	linkEncryption   = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.11:8443?encryption=mlkem768x25519plus.native.0rtt.ptjHQxBQxTJ9MWr2cd5qWIflBSACHOevTauCQwa_71U&flow=xtls-rprx-vision&security=none&type=tcp#JP"
	// Plain VLESS (no TLS / encryption) only passes Xray's check on a private address;
	// since v26.10.29 (#7249) that means Go's IsPrivate, so TEST-NET 203.0.113.x no longer counts.
	linkKCP = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@10.0.113.12:2096?encryption=none&security=none&type=kcp&headerType=wechat-video&seed=s3cr3t#SG"
)

func entries(t *testing.T) []Entry {
	t.Helper()
	var out []Entry
	for i, l := range []string{linkXHTTPReality, linkXHTTPTLS, linkEncryption, linkKCP} {
		n, err := nodes.ParseLink(l)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, Entry{Key: Key(n), Endpoint: Endpoint{Port: 30001 + i, User: "u", Pass: "p"}, Node: n})
	}
	return out
}

func TestBuildConfigShape(t *testing.T) {
	raw, err := BuildConfig(entries(t), "")
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Inbounds []struct {
			Tag, Listen, Protocol string
			Port                  int
			Settings              map[string]any
		}
		Outbounds []struct {
			Tag, Protocol  string
			Settings       map[string]any
			StreamSettings map[string]any
		}
		Routing struct {
			Rules []struct {
				InboundTag  []string
				OutboundTag string
			}
		}
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	// 4 nodes + the freedom outbound / DNS rule that keep server lookups off the nodes.
	if len(cfg.Inbounds) != 4 || len(cfg.Outbounds) != 5 || len(cfg.Routing.Rules) != 5 {
		t.Fatalf("counts: %s", raw)
	}
	for i, in := range cfg.Inbounds {
		if in.Listen != "127.0.0.1" || in.Protocol != "socks" || in.Settings["udp"] != true || in.Settings["auth"] != "password" {
			t.Fatalf("inbound %d: %+v", i, in)
		}
		r := cfg.Routing.Rules[i+1] // rule 0 sends the DNS module direct
		if r.InboundTag[0] != in.Tag || r.OutboundTag != cfg.Outbounds[i].Tag {
			t.Fatalf("rule %d does not pair inbound with outbound", i)
		}
	}
	x := cfg.Outbounds[0].StreamSettings
	xs := x["xhttpSettings"].(map[string]any)
	rs := x["realitySettings"].(map[string]any)
	if x["network"] != "xhttp" || xs["path"] != "/xhttp-a1" || xs["mode"] != "auto" || xs["extra"] == nil {
		t.Fatalf("xhttp stream: %v", x)
	}
	if rs["password"] != "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw" || rs["serverName"] != "www.microsoft.com" || rs["shortId"] != "6ba85179e30d4fc2" {
		t.Fatalf("reality: %v", rs)
	}
	if enc := cfg.Outbounds[2].Settings["encryption"].(string); !strings.HasPrefix(enc, "mlkem768x25519plus.") {
		t.Fatalf("encryption: %v", cfg.Outbounds[2].Settings)
	}
	k := cfg.Outbounds[3].StreamSettings
	if k["network"] != "kcp" || k["finalmask"] == nil || strings.Contains(string(raw), `"seed"`) {
		t.Fatalf("kcp must use finalmask, not seed: %v", k)
	}
	if strings.Contains(string(raw), "allowInsecure") {
		t.Fatal("allowInsecure is fatal in Xray v26")
	}
}

func TestBuildConfigRejectsBadInput(t *testing.T) {
	if _, err := BuildConfig(nil, ""); err == nil {
		t.Fatal("empty config accepted")
	}
	n := &nodes.Node{Type: "shadowsocks", Server: "a", Port: 1}
	if _, err := Outbound(n, "x"); err == nil {
		t.Fatal("unsupported type accepted")
	}
}

// xrayBin finds a real xray.exe: $PROXYSPLIT_XRAY or <repo>/bin/xray.exe.
func xrayBin(t *testing.T) string {
	t.Helper()
	p := os.Getenv("PROXYSPLIT_XRAY")
	if p == "" {
		p = filepath.Join("..", "..", "bin", ExeName)
		if runtime.GOOS == "darwin" {
			p = filepath.Join("..", "..", "bin", "darwin", ExeName)
		}
	}
	if _, err := os.Stat(p); err != nil {
		t.Skip("xray.exe not present (scripts/fetch-core.ps1 or build-xray.ps1)")
	}
	return p
}

// TestConfigAcceptedByRealXray runs `xray run -test` on the generated config.
func TestConfigAcceptedByRealXray(t *testing.T) {
	bin := xrayBin(t)
	raw, err := BuildConfig(entries(t), "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "xray.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(bin, "run", "-test", "-c", path).CombinedOutput()
	if err != nil {
		t.Fatalf("xray rejected config: %v\n%s\n%s", err, out, raw)
	}
}

// TestSidecarStartsAndStops starts the real sidecar and checks its ports.
func TestSidecarStartsAndStops(t *testing.T) {
	bin := xrayBin(t)
	abs, _ := filepath.Abs(bin)
	sc := NewSidecar(abs, t.TempDir(), func(l string) { t.Log(l) })
	var ns []*nodes.Node
	for _, e := range entries(t) {
		ns = append(ns, e.Node)
	}
	ports, err := sc.Ensure(ns)
	if err != nil {
		t.Fatal(err)
	}
	defer sc.Stop()
	if len(ports) != 4 || !sc.Running() {
		t.Fatalf("ports %v running %v", ports, sc.Running())
	}
	again, err := sc.Ensure(ns) // same node set: no restart, same ports
	if err != nil || again[Key(ns[0])] != ports[Key(ns[0])] {
		t.Fatalf("re-ensure changed ports: %v %v", again, err)
	}
	if _, err := sc.Ensure(nil); err != nil || sc.Running() {
		t.Fatalf("no xray nodes must stop the sidecar (err %v)", err)
	}
}

func TestMissingBinary(t *testing.T) {
	sc := NewSidecar(filepath.Join(t.TempDir(), ExeName), t.TempDir(), nil)
	n, _ := nodes.ParseLink(linkXHTTPTLS)
	_, err := sc.Ensure([]*nodes.Node{n})
	if err == nil || !strings.Contains(err.Error(), "该节点需要 Xray 内核") {
		t.Fatalf("want Chinese missing-core error, got %v", err)
	}
}
