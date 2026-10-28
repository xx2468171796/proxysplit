package nodereport

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStepSendsOnStartChangeAndKeepAlive(t *testing.T) {
	var got []Body
	fail := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(500)
			return
		}
		zr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		var b Body
		_ = json.NewDecoder(zr).Decode(&b)
		if r.Header.Get("X-Device-Id") != b.DeviceID || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("headers %v", r.Header)
		}
		got = append(got, b)
	}))
	defer srv.Close()
	inv := Inventory{SelectedID: "a", Nodes: []Node{{ID: "a", Type: "vless", Link: "vless://x"}}}
	r := &Reporter{Endpoint: srv.URL, Client: srv.Client(), DeviceID: func() string { return "dev" },
		Token: func() string { return "tok" }, AppVersion: "1.0", Source: func() Inventory { return inv }}
	now := time.Now()
	ctx := context.Background()
	if !r.Step(ctx, now) || len(got) != 1 || got[0].Reason != "start" || got[0].Nodes[0].Link != "vless://x" {
		t.Fatalf("start: %+v", got)
	}
	if r.Step(ctx, now.Add(time.Minute)) {
		t.Fatal("unchanged inventory must not upload")
	}
	inv.Nodes = append(inv.Nodes, Node{ID: "b"})
	if !r.Step(ctx, now.Add(2*time.Minute)) || got[1].Reason != "change" {
		t.Fatalf("change: %+v", got)
	}
	if !r.Step(ctx, now.Add(7*time.Hour)) || got[2].Reason != "periodic" {
		t.Fatalf("keep-alive: %+v", got)
	}
	fail = true
	inv.Nodes = inv.Nodes[:1]
	r.Step(ctx, now.Add(8*time.Hour))
	if r.Step(ctx, now.Add(8*time.Hour+10*time.Second)) {
		t.Fatal("must back off after a failure")
	}
	fail = false
	if !r.Step(ctx, now.Add(8*time.Hour+time.Minute)) || len(got) != 4 || got[3].Reason != "change" {
		t.Fatalf("retry after backoff: %d", len(got))
	}
}
