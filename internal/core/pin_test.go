package core

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

const pinDomain, pinIP = "node.example.com", "203.0.113.7"

const (
	testUUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
	testPBK  = "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw"
)

var pinIPs = map[string]string{pinDomain: pinIP}

func pinCases() map[string]*nodes.Node {
	d := pinDomain
	return map[string]*nodes.Node{
		"vless-tls":      {Type: "vless", Server: d, Port: 443, UUID: testUUID, Security: "tls"},
		"vless-tls-host": {Type: "vless", Server: d, Port: 443, UUID: testUUID, Security: "tls", Host: "cdn.example.com", Network: "ws", Path: "/w"},
		"vless-reality":  {Type: "vless", Server: d, Port: 443, UUID: testUUID, Security: "reality", PublicKey: testPBK, ShortID: "ab", Flow: "xtls-rprx-vision"},
		"vless-ws-notls": {Type: "vless", Server: d, Port: 80, UUID: testUUID, Network: "ws", Path: "/w"},
		"vless-ws-tls":   {Type: "vless", Server: d, Port: 443, UUID: testUUID, Network: "ws", Path: "/w", Security: "tls"},
		"vmess-ws":       {Type: "vmess", Server: d, Port: 443, UUID: testUUID, Network: "ws", Path: "/v", Security: "tls"},
		"vmess-h2":       {Type: "vmess", Server: d, Port: 443, UUID: testUUID, Network: "h2", Path: "/v", Security: "tls"},
		"vmess-grpc":     {Type: "vmess", Server: d, Port: 443, UUID: testUUID, Network: "grpc", Path: "svc", Security: "tls"},
		"trojan-default": {Type: "trojan", Server: d, Port: 443, Password: "p"},
		"trojan-sni":     {Type: "trojan", Server: d, Port: 443, Password: "p", SNI: "front.example.com", Security: "tls"},
		"hysteria2":      {Type: "hysteria2", Server: d, Port: 443, Password: "p"},
		"tuic":           {Type: "tuic", Server: d, Port: 443, UUID: testUUID, Password: "p"},
		"anytls":         {Type: "anytls", Server: d, Port: 443, Password: "p"},
		"shadowsocks":    {Type: "shadowsocks", Server: d, Port: 8388, Method: "aes-128-gcm", Password: "p"},
		"socks":          {Type: "socks", Server: d, Port: 1080, Username: "a", Password: "b"},
		"http-tls":       {Type: "http", Server: d, Port: 443, Security: "tls"},
	}
}

// replaceServer swaps every occurrence of the IP back to the domain so the
// pinned outbound can be compared with the original one.
func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestPinNodeKeepsDomainNamesSingBox(t *testing.T) {
	for name, n := range pinCases() {
		orig, err := buildOutbound(n, "proxy")
		if err != nil {
			t.Fatal(name, err)
		}
		p := PinNode(n, pinIPs)
		pinned, err := buildOutbound(p, "proxy")
		if err != nil {
			t.Fatal(name, err)
		}
		if pinned["server"] != pinIP {
			t.Fatalf("%s: server %v", name, pinned["server"])
		}
		if n.Server != pinDomain {
			t.Fatalf("%s: original node mutated", name)
		}
		pinned["server"] = pinDomain
		// A ws / h2 transport without Host now carries the domain explicitly
		// (it used to default to the dialed address = the domain).
		if tr, ok := pinned["transport"].(M); ok && n.Host == "" {
			delete(tr, "headers")
			delete(tr, "host")
		}
		if !reflect.DeepEqual(asJSON(t, orig), asJSON(t, pinned)) {
			t.Errorf("%s:\n orig   %s\n pinned %s", name, asJSON(t, orig), asJSON(t, pinned))
		}
	}
}

func TestPinNodeSetsHostHeader(t *testing.T) {
	n := pinCases()["vless-ws-notls"]
	ob, _ := buildOutbound(PinNode(n, pinIPs), "proxy")
	if h := ob["transport"].(M)["headers"].(M)["Host"]; h != pinDomain {
		t.Fatalf("ws Host %v", h)
	}
	n = pinCases()["vmess-h2"]
	ob, _ = buildOutbound(PinNode(n, pinIPs), "proxy")
	if h := ob["transport"].(M)["host"].([]string); h[0] != pinDomain {
		t.Fatalf("h2 host %v", h)
	}
	n = pinCases()["vless-tls-host"]
	ob, _ = buildOutbound(PinNode(n, pinIPs), "proxy")
	if ob["tls"].(M)["server_name"] != "cdn.example.com" || ob["transport"].(M)["headers"].(M)["Host"] != "cdn.example.com" {
		t.Fatalf("explicit host changed: %v", ob)
	}
}

func TestPinNodeSkips(t *testing.T) {
	ss := &nodes.Node{Type: "shadowsocks", Server: pinDomain, Port: 1, Plugin: "obfs-local", PluginOpts: "obfs=http"}
	ipNode := &nodes.Node{Type: "trojan", Server: "1.2.3.4", Port: 443}
	raw := &nodes.Node{Type: "vless", Server: pinDomain, Outbounds: []json.RawMessage{json.RawMessage(`{"type":"direct","tag":"x"}`)}}
	other := &nodes.Node{Type: "trojan", Server: "other.example", Port: 443}
	for _, n := range []*nodes.Node{ss, ipNode, raw, other, nil} {
		if PinNode(n, pinIPs) != n {
			t.Fatalf("pinned %+v", n)
		}
	}
	if PinNode(pinCases()["trojan-default"], nil) == nil {
		t.Fatal("nil map")
	}
}

func TestPinNodeKeepsDomainNamesXray(t *testing.T) {
	cases := map[string]*nodes.Node{
		"vless-xhttp-reality": {Type: "vless", Server: pinDomain, Port: 443, UUID: testUUID, Security: "reality", PublicKey: testPBK, ShortID: "ab", Network: "xhttp", Path: "/x"},
		"vless-xhttp-tls":     {Type: "vless", Server: pinDomain, Port: 443, UUID: testUUID, Security: "tls", Network: "xhttp", Path: "/x"},
		"vmess-ws-tls":        {Type: "vmess", Server: pinDomain, Port: 443, UUID: testUUID, Security: "tls", Network: "ws", Path: "/x"},
		"trojan-grpc":         {Type: "trojan", Server: pinDomain, Port: 443, Password: "p", Security: "tls", Network: "grpc", Path: "s"},
	}
	for name, n := range cases {
		orig, err := xray.Outbound(n, "o")
		if err != nil {
			t.Fatal(name, err)
		}
		pinned, err := xray.Outbound(PinNode(n, pinIPs), "o")
		if err != nil {
			t.Fatal(name, err)
		}
		pj := asJSON(t, pinned)
		if !strings.Contains(pj, `"address":"`+pinIP+`"`) {
			t.Fatalf("%s: %s", name, pj)
		}
		for _, k := range []string{"tlsSettings", "realitySettings"} {
			os, ps := orig["streamSettings"].(xray.M)[k], pinned["streamSettings"].(xray.M)[k]
			if asJSON(t, os) != asJSON(t, ps) {
				t.Errorf("%s %s:\n %s\n %s", name, k, asJSON(t, os), asJSON(t, ps))
			}
		}
		for _, k := range []string{"wsSettings", "xhttpSettings"} {
			if s, ok := pinned["streamSettings"].(xray.M)[k].(xray.M); ok && s["host"] != pinDomain {
				t.Errorf("%s %s host %v", name, k, s["host"])
			}
		}
	}
}

func TestBuildTUNUsesServerIPs(t *testing.T) {
	n := &nodes.Node{ID: "n1", Name: "n", Type: "vless", Server: pinDomain, Port: 443, UUID: testUUID, Security: "tls", Network: "ws", Path: "/w"}
	en := &nodes.Node{ID: "n2", Name: "e", Type: "trojan", Server: pinDomain, Port: 443, Password: "p"}
	cfg, err := BuildTUNConfig(n, "info", Options{ServerIPs: pinIPs, ExtraNodes: []ExtraNode{{Tag: "line-x", Node: en}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tag := range []string{"proxy", "line-x"} {
		ob := outboundByTag(t, cfg, tag)
		tls := ob["tls"].(map[string]any)
		if ob["server"] != pinIP || tls["server_name"] != pinDomain {
			t.Fatalf("%s: %v", tag, ob)
		}
	}
}
