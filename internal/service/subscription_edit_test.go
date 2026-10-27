package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEditSubIsTransactional(t *testing.T) {
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("socks://127.0.0.1:1080#first"))
	}))
	defer first.Close()
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("socks://127.0.0.1:2080#second"))
	}))
	defer second.Close()
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "no", http.StatusBadGateway)
	}))
	defer broken.Close()

	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddSub("old name", first.URL, false); err != nil {
		t.Fatalf("add subscription: %v", err)
	}
	id := s.GetSubs()[0].ID

	if err := s.SaveSub(id, "new name", broken.URL, SubOptions{}); err == nil {
		t.Fatal("broken replacement URL must fail")
	}
	unchanged := s.GetSubs()[0]
	if unchanged.Name != "old name" || unchanged.URL != first.URL || s.Nodes()[0].Port != 1080 {
		t.Fatalf("failed edit changed persisted state: sub=%+v node=%+v", unchanged, s.Nodes()[0])
	}

	if err := s.SaveSub(id, "new name", second.URL, SubOptions{}); err != nil {
		t.Fatalf("edit subscription: %v", err)
	}
	edited := s.GetSubs()[0]
	if edited.ID != id || edited.Name != "new name" || edited.URL != second.URL {
		t.Fatalf("unexpected edited subscription: %+v", edited)
	}
	gotNodes := s.Nodes()
	if len(gotNodes) != 1 || gotNodes[0].Port != 2080 || gotNodes[0].SubID != id {
		t.Fatalf("edited nodes not replaced atomically: %+v", gotNodes)
	}
}
