package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNodeViaRules(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("socks://127.0.0.1:1080#前置\nsocks://198.51.100.7:8022#被墙"))
	}))
	defer srv.Close()
	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddSub("机场", srv.URL, false); err != nil {
		t.Fatal(err)
	}
	list := s.Nodes()
	front, blocked := list[0], list[1]
	if msg := s.SetNodeVia(blocked.ID, blocked.ID); msg == "" {
		t.Fatal("self as front must be refused")
	}
	if msg := s.SetNodeVia(blocked.ID, front.ID); msg != "" {
		t.Fatalf("set via: %s", msg)
	}
	if msg := s.SetNodeVia(front.ID, blocked.ID); msg == "" {
		t.Fatal("front with its own front (two hops) must be refused")
	}
	s.mu.Lock()
	c := s.chainLocked(s.nodeByID(blocked.ID))
	s.mu.Unlock()
	if c.ViaNode == nil || c.ViaNode.ID != front.ID || s.nodeByID(blocked.ID).ViaNode != nil {
		t.Fatal("chain must resolve on a copy, never on the stored node")
	}
	if err := s.UpdateSub(s.GetSubs()[0].ID); err != nil {
		t.Fatal(err)
	}
	if s.nodeByID(blocked.ID).Via != front.ID {
		t.Fatal("subscription refresh must keep the front choice")
	}
	if msg := s.RemoveNode(front.ID); msg != "" {
		t.Fatal(msg)
	}
	if s.nodeByID(blocked.ID).Via != "" {
		t.Fatal("deleting the front must clear the reference")
	}
}
