package service

import (
	"testing"

	"proxysplit/internal/nodes"
)

func TestSetNodeCoreValidatesAndPersists(t *testing.T) {
	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "S", "203.0.113.5", 1080, "u", "p"); msg != "" {
		t.Fatal(msg)
	}
	id := s.Nodes()[0].ID
	if _, err := s.SetNodeCore("missing", "xray"); err == nil {
		t.Fatal("missing node accepted")
	}
	if _, err := s.SetNodeCore(id, "v2ray"); err == nil {
		t.Fatal("unknown core accepted")
	}
	ch, err := s.SetNodeCore(id, "xray")
	if err != nil || ch.From != nodes.CoreSingBox || ch.To != nodes.CoreXray || ch.NodeType != "socks" {
		t.Fatalf("SetNodeCore = %+v, %v", ch, err)
	}
	if got := s.Nodes()[0]; got.Core != nodes.CoreXray || got.EffectiveCore() != nodes.CoreXray {
		t.Fatalf("node core = %q", got.Core)
	}
	if _, err := s.SetNodeCore(id, "auto"); err != nil || s.Nodes()[0].Core != "" {
		t.Fatalf("auto: %v %q", err, s.Nodes()[0].Core)
	}
}

func TestSubscriptionRefreshKeepsCore(t *testing.T) {
	old := []*nodes.Node{
		{ID: "a", Name: "A", Type: "socks", Server: "203.0.113.1", Port: 1080, Core: nodes.CoreXray},
		{ID: "b", Name: "B", Type: "vless", Server: "203.0.113.2", Port: 443, Core: nodes.CoreSingBox},
	}
	fresh := []*nodes.Node{
		{ID: "a2", Name: "A", Type: "socks", Server: "203.0.113.1", Port: 1080},
		// B became an XHTTP node: forced sing-box is no longer allowed.
		{ID: "b2", Name: "B", Type: "vless", Server: "203.0.113.2", Port: 443, Network: "xhttp"},
	}
	reconcileSubscriptionNodes(old, fresh)
	keepNodeCores(old, fresh)
	if fresh[0].ID != "a" || fresh[0].Core != nodes.CoreXray {
		t.Fatalf("node A = %+v", fresh[0])
	}
	if fresh[1].Core != "" {
		t.Fatalf("invalid choice kept: %+v", fresh[1])
	}
}
