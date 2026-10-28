package service

import (
	"testing"

	"proxysplit/internal/nodes"
)

// A stale or empty selection with nodes present picks the first node; no
// nodes at all leaves nothing selected.
func TestEnsureSelectedLocked(t *testing.T) {
	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if n, _ := s.ensureSelectedLocked(); n != nil {
		t.Fatal("no nodes must select nothing")
	}
	s.cfg.Nodes = []*nodes.Node{{ID: "a", Name: "A"}, {ID: "b", Name: "B"}}
	s.cfg.SelectedID = "gone-with-its-subscription"
	n, picked := s.ensureSelectedLocked()
	if n == nil || n.ID != "a" || !picked || s.cfg.SelectedID != "a" {
		t.Fatalf("stale selection must fall back to the first node: %+v %v", n, picked)
	}
	s.cfg.SelectedID = "b"
	if n, picked := s.ensureSelectedLocked(); n.ID != "b" || picked {
		t.Fatal("a valid selection must be kept")
	}
}
