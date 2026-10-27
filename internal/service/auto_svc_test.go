package service

import (
	"encoding/json"
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

// Selecting "auto" yields a synthetic urltest node over the plain nodes only
// (no official / raw / Xray), and the choice survives a reload.
func TestAutoSelectSyntheticNode(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "普通", "1.2.3.4", 1080, "u", "p"); msg != "" {
		t.Fatal(msg)
	}
	plain := s.Nodes()[0].ID
	s.mu.Lock()
	s.cfg.Nodes = append(s.cfg.Nodes,
		&nodes.Node{ID: "off", Name: "官方", Type: "socks", Server: "1.2.3.5", Port: 1, Official: true},
		&nodes.Node{ID: "raw", Name: "整组", Type: "urltest", Outbounds: []json.RawMessage{json.RawMessage(`{"type":"direct","tag":"x"}`)}},
		&nodes.Node{ID: "xr", Name: "Xray", Type: "vless", Server: "1.2.3.6", Port: 443, UUID: "u", Network: "xhttp"},
	)
	s.save()
	s.mu.Unlock()

	s.SelectNode(AutoNodeID)
	s.mu.Lock()
	n := s.selectedNode()
	s.mu.Unlock()
	if n == nil || n.ID != AutoNodeID || n.Type != nodes.TypeURLTest || n.Name != AutoNodeName {
		t.Fatalf("synthetic node = %+v", n)
	}
	if len(n.Members) != 1 || n.Members[0].ID != plain {
		t.Fatalf("members = %+v", n.Members)
	}
	if got := len(startNodes(n, &core.Options{})); got != 2 { // group + member, for pinning
		t.Fatalf("startNodes = %d", got)
	}

	s2, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if s2.cfg.SelectedID != AutoNodeID {
		t.Fatalf("SelectedID after reload = %q", s2.cfg.SelectedID)
	}
	if st := s2.Status(); st.NodeName != AutoNodeName {
		t.Fatalf("status node name = %q", st.NodeName)
	}
}
