package nodes

import (
	"strconv"
	"strings"
	"testing"
)

// Share links as exported by v2rayN 7.x for Xray-only nodes.
const (
	linkXHTTPReality = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.10:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sid=6ba85179e30d4fc2&spx=%2F&type=xhttp&path=%2Fxhttp-a1&mode=auto&extra=%7B%22xmux%22%3A%7B%22maxConcurrency%22%3A%2216-32%22%7D%7D#HK-XHTTP-Reality"
	linkXHTTPTLS     = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@cdn.example.com:443?encryption=none&security=tls&sni=cdn.example.com&fp=chrome&alpn=h2&type=xhttp&host=cdn.example.com&path=%2Fsplit&mode=packet-up#US-XHTTP-CDN"
	linkEncryption   = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.11:8443?encryption=mlkem768x25519plus.native.0rtt.ptjHQxBQxTJ9MWr2cd5qWIflBSACHOevTauCQwa_71U&flow=xtls-rprx-vision&security=none&type=tcp#JP-Encryption"
	linkKCP          = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.12:2096?encryption=none&security=none&type=kcp&headerType=wechat-video&seed=s3cr3t#SG-mKCP"
	linkPlainReality = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.13:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.apple.com&fp=chrome&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sid=01&type=tcp#Plain"
)

func mustParse(t *testing.T, link string) *Node {
	t.Helper()
	n, err := ParseLink(link)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return n
}

func TestParseXHTTPReality(t *testing.T) {
	n := mustParse(t, linkXHTTPReality)
	if !n.NeedsXray() || n.Network != NetXHTTP || n.Security != "reality" {
		t.Fatalf("not an xray xhttp node: %+v", n)
	}
	if n.Path != "/xhttp-a1" || n.Mode != "auto" || n.Host != "" || n.SpiderX != "/" {
		t.Fatalf("xhttp fields: path=%q mode=%q host=%q spx=%q", n.Path, n.Mode, n.Host, n.SpiderX)
	}
	if n.Extra != `{"xmux":{"maxConcurrency":"16-32"}}` {
		t.Fatalf("extra = %q", n.Extra)
	}
	if n.PublicKey == "" || n.ShortID != "6ba85179e30d4fc2" || n.SNI != "www.microsoft.com" {
		t.Fatalf("reality fields: %+v", n)
	}
}

func TestParseXHTTPTLSAndSplitHTTPAlias(t *testing.T) {
	n := mustParse(t, linkXHTTPTLS)
	if !n.NeedsXray() || n.Host != "cdn.example.com" || n.Mode != "packet-up" || n.Path != "/split" {
		t.Fatalf("xhttp tls: %+v", n)
	}
	alias := mustParse(t, strings.Replace(linkXHTTPTLS, "type=xhttp", "type=splithttp", 1))
	if alias.Network != NetXHTTP || !alias.NeedsXray() {
		t.Fatalf("splithttp alias not normalised: %q", alias.Network)
	}
	if bad := mustParse(t, strings.Replace(linkXHTTPTLS, "type=xhttp", "type=xhttp&extra=not-json", 1)); bad.Extra != "" {
		t.Fatalf("malformed extra kept: %q", bad.Extra)
	}
}

func TestParseVLESSEncryptionAndKCP(t *testing.T) {
	enc := mustParse(t, linkEncryption)
	if !enc.NeedsXray() || !strings.HasPrefix(enc.Encryption, "mlkem768x25519plus.") || enc.Flow != "xtls-rprx-vision" {
		t.Fatalf("encryption node: %+v", enc)
	}
	kcp := mustParse(t, linkKCP)
	if !kcp.NeedsXray() || kcp.Network != NetKCP || kcp.HeaderType != "wechat-video" || kcp.Seed != "s3cr3t" || kcp.Path != "" {
		t.Fatalf("kcp node: %+v", kcp)
	}
}

func TestOrdinaryNodesDoNotNeedXray(t *testing.T) {
	plain := mustParse(t, linkPlainReality)
	if plain.NeedsXray() {
		t.Fatal("plain reality must stay on sing-box")
	}
	if plain.Host != "www.apple.com" { // pre-existing sni fallback untouched
		t.Fatalf("host = %q", plain.Host)
	}
	for _, l := range []string{
		"trojan://pw@example.com:443?sni=example.com#t",
		"ss://YWVzLTI1Ni1nY206cHc=@example.com:8388#s",
		"hysteria2://pw@example.com:443#h",
	} {
		if mustParse(t, l).NeedsXray() {
			t.Fatalf("%s should not need xray", l)
		}
	}
	raw := &Node{Type: "vless", Network: "xhttp", Outbounds: nil}
	raw.Outbounds = append(raw.Outbounds, []byte(`{"type":"direct","tag":"x"}`))
	if raw.NeedsXray() {
		t.Fatal("raw sing-box outbounds never go to xray")
	}
}

const clashXHTTPYAML = `
proxies:
  - name: mihomo-xhttp
    type: vless
    server: 203.0.113.20
    port: 443
    uuid: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    network: xhttp
    tls: true
    servername: www.microsoft.com
    client-fingerprint: chrome
    encryption: ""
    reality-opts:
      public-key: Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw
      short-id: 6ba85179e30d4fc2
    xhttp-opts:
      path: /xh
      host: www.microsoft.com
      mode: stream-one
  - name: mihomo-ws
    type: vless
    server: 203.0.113.21
    port: 443
    uuid: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    network: ws
    tls: true
    ws-opts:
      path: /ws
`

func TestClashXHTTPAndStableIDs(t *testing.T) {
	ns, err := ParseClashYAML([]byte(clashXHTTPYAML))
	if err != nil || len(ns) != 2 {
		t.Fatalf("parse: %v (%d)", err, len(ns))
	}
	x, ws := ns[0], ns[1]
	if !x.NeedsXray() || x.Path != "/xh" || x.Mode != "stream-one" || x.Security != "reality" {
		t.Fatalf("clash xhttp: %+v", x)
	}
	if ws.NeedsXray() {
		t.Fatal("ws node must stay on sing-box")
	}
	// Ordinary nodes keep the identity they had before Xray support.
	want := shortHash(strings.Join([]string{
		"clash", ws.Type, ws.Server, strconv.Itoa(ws.Port), ws.UUID, ws.Username,
		ws.Password, ws.Method, ws.Network, ws.Host, ws.Path, ws.Security, ws.SNI,
		ws.Plugin, ws.PluginOpts,
	}, "|"))
	if ws.ID != want {
		t.Fatalf("ordinary clash node ID changed: %s != %s", ws.ID, want)
	}
}
