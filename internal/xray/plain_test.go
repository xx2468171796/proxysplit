package xray

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

func plainNodes() []*nodes.Node {
	return []*nodes.Node{
		{ID: "ss", Name: "ss", Type: "shadowsocks", Server: "203.0.113.20", Port: 8388, Method: "aes-128-gcm", Password: "pw", Core: nodes.CoreXray},
		{ID: "ss22", Name: "ss22", Type: "shadowsocks", Server: "203.0.113.21", Port: 8389, Method: "2022-blake3-aes-128-gcm", Password: "AAAAAAAAAAAAAAAAAAAAAA==", Core: nodes.CoreXray},
		{ID: "socks", Name: "socks", Type: "socks", Server: "203.0.113.22", Port: 1080, Username: "u", Password: "p", Core: nodes.CoreXray},
		{ID: "socks-anon", Name: "socks-anon", Type: "socks", Server: "203.0.113.23", Port: 1080, Core: nodes.CoreXray},
		{ID: "https", Name: "https", Type: "http", Server: "proxy.example.com", Port: 443, Username: "u", Password: "p", Security: "tls", SNI: "proxy.example.com", Core: nodes.CoreXray},
	}
}

func plainEntries() []Entry {
	var out []Entry
	for i, n := range plainNodes() {
		out = append(out, Entry{Key: Key(n), Endpoint: Endpoint{Port: 32001 + i, User: "u", Pass: "p"}, Node: n})
	}
	return out
}

func TestPlainOutbounds(t *testing.T) {
	ns := plainNodes()
	ss, err := Outbound(ns[0], "o")
	if err != nil {
		t.Fatal(err)
	}
	s := ss["settings"].(M)
	if ss["protocol"] != "shadowsocks" || s["method"] != "aes-128-gcm" || s["password"] != "pw" || s["port"] != 8388 {
		t.Fatalf("ss outbound = %v", ss)
	}
	so, _ := Outbound(ns[2], "o")
	if s := so["settings"].(M); s["user"] != "u" || s["pass"] != "p" || so["protocol"] != "socks" {
		t.Fatalf("socks outbound = %v", so)
	}
	anon, _ := Outbound(ns[3], "o")
	if _, ok := anon["settings"].(M)["user"]; ok {
		t.Fatalf("anonymous socks has user: %v", anon)
	}
	h, _ := Outbound(ns[4], "o")
	if st := h["streamSettings"].(M); st["security"] != "tls" || h["protocol"] != "http" {
		t.Fatalf("https outbound = %v", h)
	}
	plugin := *ns[0]
	plugin.Plugin = "obfs-local"
	if _, err := Outbound(&plugin, "o"); err == nil {
		t.Fatal("ss with SIP003 plugin accepted")
	}
}

// TestPlainConfigAcceptedByRealXray runs `xray run -test` on ss / socks / http.
func TestPlainConfigAcceptedByRealXray(t *testing.T) {
	bin := xrayBin(t)
	raw, err := BuildConfig(plainEntries(), "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "xray.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, "run", "-test", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("xray rejected config: %v\n%s\n%s", err, out, raw)
	}
}
