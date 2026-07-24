package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClashTrafficReadsCumulativeCounters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"downloadTotal": 7340032,
			"uploadTotal": 1572864,
			"connections": [{"id":"a"},{"id":"b"}]
		}`))
	}))
	defer server.Close()

	got, err := clashTrafficURL(server.URL, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Running || got.DownBytes != 7340032 || got.UpBytes != 1572864 || got.ActiveConns != 2 {
		t.Fatalf("unexpected traffic snapshot: %+v", got)
	}
}

func TestClashTrafficRejectsUnauthorizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()
	if _, err := clashTrafficURL(server.URL, "wrong"); err == nil {
		t.Fatal("unauthorized Clash API response must fail")
	}
}
