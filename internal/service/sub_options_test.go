package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubOptionsUserAgentAndFilters(t *testing.T) {
	var gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		_, _ = w.Write([]byte("socks://127.0.0.1:1080#香港01\nsocks://127.0.0.1:1081#日本01\nsocks://127.0.0.1:1082#香港-剩余流量"))
	}))
	defer srv.Close()
	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddSub("机场", srv.URL, true); err != nil {
		t.Fatal(err)
	}
	id := s.GetSubs()[0].ID
	if err := s.SetSubOptions(id, SubOptions{UserAgent: "v2rayN/7.0", Include: "香港", Exclude: "流量", IntervalMin: 3}); err != nil {
		t.Fatal(err)
	}
	if gotUA != "v2rayN/7.0" {
		t.Fatalf("User-Agent = %q", gotUA)
	}
	if n := s.Nodes(); len(n) != 1 || n[0].Port != 1080 {
		t.Fatalf("filtered nodes = %+v", n)
	}
	if sub := s.GetSubs()[0]; sub.IntervalMin != 10 || sub.Include != "香港" {
		t.Fatalf("options not saved (interval floors at 10): %+v", sub)
	}
	if err := s.SetSubOptions(id, SubOptions{Include: "("}); err == nil {
		t.Fatal("bad regex must be rejected")
	}
	if err := s.SetSubOptions(id, SubOptions{Include: "美国"}); err == nil {
		t.Fatal("a filter that keeps nothing must fail and keep the old nodes")
	}
	if n := s.Nodes(); len(n) != 1 {
		t.Fatalf("failed refresh must keep nodes: %+v", n)
	}
}

func TestSubOptionsFailedFetchKeepsOldOptions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("socks://127.0.0.1:1080#香港01"))
	}))
	defer srv.Close()
	s, _ := New(t.TempDir(), t.TempDir())
	_ = s.AddSub("机场", srv.URL, true)
	id := s.GetSubs()[0].ID
	if err := s.SetSubOptions(id, SubOptions{Include: "美国"}); err == nil {
		t.Fatal("must fail")
	}
	if sub := s.GetSubs()[0]; sub.Include != "" {
		t.Fatalf("failed options must not be saved: %+v", sub)
	}
}
