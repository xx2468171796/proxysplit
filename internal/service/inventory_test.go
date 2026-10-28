package service

import (
	"strings"
	"testing"
)

// The node report carries every node with its full share link and front node.
func TestNodeInventoryHasFullLinks(t *testing.T) {
	s, _ := New(t.TempDir(), t.TempDir())
	if added, _ := s.AddNodes("socks://dXNlcjpwYXNz@127.0.0.1:1080#A\nsocks://127.0.0.1:1081#B"); added != 2 {
		t.Fatalf("added %d", added)
	}
	ns := s.Nodes()
	if msg := s.SetNodeVia(ns[0].ID, ns[1].ID); msg != "" {
		t.Fatal(msg)
	}
	inv := s.NodeInventory()
	if len(inv.Nodes) != 2 || inv.SelectedID == "" {
		t.Fatalf("inventory = %+v", inv)
	}
	a := inv.Nodes[0]
	if !strings.HasPrefix(a.Link, "socks://dXNlcjpwYXNz@") || a.Source != "manual" || a.Via != ns[1].ID || a.Core != "sing-box" {
		t.Fatalf("node = %+v", a)
	}
}
