package nodes

import (
	"encoding/json"
	"testing"
)

func TestEffectiveCoreMatrix(t *testing.T) {
	xhttp := &Node{Type: "vless", Network: "xhttp"}
	vless := &Node{Type: "vless", Network: "ws"}
	socks := &Node{Type: "socks"}
	ssPlugin := &Node{Type: "shadowsocks", Method: "aes-128-gcm", Plugin: "obfs-local"}
	ss := &Node{Type: "shadowsocks", Method: "aes-128-gcm"}
	hy2 := &Node{Type: "hysteria2"}
	cases := []struct {
		name string
		n    *Node
		core string
		want string
	}{
		{"xhttp auto", xhttp, CoreAuto, CoreXray},
		{"xhttp forced sing-box", xhttp, CoreSingBox, CoreXray},
		{"vless auto", vless, CoreAuto, CoreSingBox},
		{"vless xray", vless, CoreXray, CoreXray},
		{"vless sing-box", vless, CoreSingBox, CoreSingBox},
		{"socks xray", socks, CoreXray, CoreXray},
		{"ss xray", ss, CoreXray, CoreXray},
		{"ss plugin xray", ssPlugin, CoreXray, CoreSingBox},
		{"hy2 xray", hy2, CoreXray, CoreSingBox},
	}
	for _, c := range cases {
		n := *c.n
		n.Core = c.core
		if got := n.EffectiveCore(); got != c.want {
			t.Errorf("%s: EffectiveCore = %s, want %s", c.name, got, c.want)
		}
	}
	var nilNode *Node
	if nilNode.UseXray() {
		t.Fatal("nil node uses xray")
	}
}

func TestValidateCore(t *testing.T) {
	if err := (&Node{Type: "vless", Network: "kcp"}).ValidateCore(CoreSingBox); err == nil {
		t.Fatal("kcp node accepted sing-box")
	}
	if err := (&Node{Type: "hysteria2"}).ValidateCore(CoreXray); err == nil {
		t.Fatal("hysteria2 accepted xray")
	}
	if err := (&Node{Type: "socks"}).ValidateCore(CoreXray); err != nil {
		t.Fatal(err)
	}
	if err := (&Node{Type: "socks"}).ValidateCore("v2ray"); err == nil {
		t.Fatal("unknown core accepted")
	}
	raw := &Node{Type: "vless", Outbounds: []json.RawMessage{json.RawMessage(`{"type":"vless"}`)}}
	if err := raw.ValidateCore(CoreXray); err == nil {
		t.Fatal("raw node accepted xray")
	}
}
