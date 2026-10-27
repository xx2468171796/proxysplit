package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// With the core stopped only the direct exit is probed; the AI path reports
// "off" without any request (it must never fall back to this PC's network).
func TestExitsCoreStopped(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	var traces, lookups atomic.Int32
	trace := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		traces.Add(1)
		fmt.Fprint(w, "fl=1\nip=203.0.113.7\nloc=TW\n")
	}))
	defer trace.Close()
	info := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		lookups.Add(1)
		fmt.Fprint(w, `{"ip":"203.0.113.7","country_code":"TW","city":"Taipei","asn":{"asn":"AS3462","name":"HiNet","type":"isp"}}`)
	}))
	defer info.Close()
	oldTrace, oldAI, oldInfo := exitTraceURL, exitAITraceURL, ipInfoURL
	exitTraceURL, exitAITraceURL, ipInfoURL = trace.URL, trace.URL+"/ai", info.URL+"/"
	defer func() { exitTraceURL, exitAITraceURL, ipInfoURL = oldTrace, oldAI, oldInfo }()

	rep := s.Exits(context.Background())
	if rep.Direct.State != "ok" || rep.Direct.IP != "203.0.113.7" || rep.Direct.City != "Taipei" || rep.Direct.Kind != "住宅宽带 IP" {
		t.Fatalf("direct = %+v", rep.Direct)
	}
	if rep.Proxy.State != "off" || rep.AI.State != "off" || rep.AI.IP != "" {
		t.Fatalf("stopped core: proxy %+v ai %+v", rep.Proxy, rep.AI)
	}
	if traces.Load() != 1 {
		t.Fatalf("only the direct trace may run, got %d", traces.Load())
	}
	// Within exitsFresh the result is shared; after it, the IP details stay cached.
	s.Exits(context.Background())
	s.exits.at = s.exits.at.Add(-exitsFresh)
	s.Exits(context.Background())
	if traces.Load() != 2 || lookups.Load() != 1 {
		t.Fatalf("traces %d lookups %d, want 2 and 1", traces.Load(), lookups.Load())
	}
}
