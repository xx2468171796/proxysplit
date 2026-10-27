package telemetry

import (
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSanitize(t *testing.T) {
	cases := []struct{ in, mustNot, must string }{
		{"import vless://11111111-2222-4333-8444-555555555555@1.2.3.4:443?security=reality&pbk=abc#hk", "1.2.3.4:443", "vless://[redacted]"},
		{"ss://YWVzLTI1Ni1nY206cGFzcw@host:8388#x", "YWVz", "ss://[redacted]"},
		{`{"password":"hunter2","server":"a.com"}`, "hunter2", `"password":"[redacted]"`},
		{"uuid=11111111-2222-4333-8444-555555555555 ok", "11111111", "[redacted]"},
		{"id 11111111-2222-4333-8444-555555555555 failed", "11111111", "[uuid]"},
		{"public_key: Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXg", "Zm9vYmFy", "[redacted]"},
		{"reality key Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXg end", "Zm9vYmFy", "[secret]"},
		{"Authorization: Bearer abcdefghijklmnop", "abcdefghijklmnop", "[redacted]"},
		{"token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl here", "eyJhbGci", "[jwt]"},
		{"GET https://api.example.com/sub/path?token=xyz&a=1 200", "xyz", "https://api.example.com/sub/path?[redacted]"},
		{"proxy https://user:pw@host.com/x", "user:pw", "https://[redacted]@host.com"},
		{"secret=clash123 port 9090", "clash123", "secret=[redacted]"},
		{"mail alice.smith@example.com", "alice.smith", "a***@example.com"},
		{"dial tcp 8.8.8.8:443 via www.google.com timeout", "", "8.8.8.8:443 via www.google.com"},
	}
	for _, c := range cases {
		got := Sanitize(c.in)
		if c.mustNot != "" && strings.Contains(got, c.mustNot) {
			t.Errorf("Sanitize(%q) = %q still contains %q", c.in, got, c.mustNot)
		}
		if !strings.Contains(got, c.must) {
			t.Errorf("Sanitize(%q) = %q, want it to contain %q", c.in, got, c.must)
		}
	}
	if got := Sanitize(strings.Repeat("a b ", 3000)); len(got) > maxLineLen+40 {
		t.Errorf("long line not truncated: %d", len(got))
	}
}

func TestSanitizeMap(t *testing.T) {
	m := SanitizeMap(map[string]any{"lanPass": "x", "server": "1.2.3.4", "type": "vless", "nested": map[string]any{"token": "t"}, "list": []string{"vmess://abc"}})
	if m["lanPass"] != "[redacted]" || m["server"] != "[redacted]" || m["type"] != "vless" {
		t.Fatalf("map %v", m)
	}
	if m["nested"].(map[string]any)["token"] != "[redacted]" || m["list"].([]string)[0] != "vmess://[redacted]" {
		t.Fatalf("nested %v", m)
	}
}

func TestClassify(t *testing.T) {
	cases := map[[2]string]string{
		{ProxyStart, "core exited on start (TUN/wintun error — check the log)"}: ErrTunCreate,
		{ProxyStart, "检测到火绒拦截了内核"}:                                              ErrBlockedAV,
		{NodeLatency, "context deadline exceeded"}:                              ErrNodeTimeout,
		{NodeLatency, "lookup x.com: no such host"}:                             ErrDNS,
		{SubAdd, "invalid character 'x'"}:                                       ErrParse,
		{AppUpdate, "sha256 mismatch"}:                                          ErrUpdateVerify,
		{AppUpdate, "connection reset"}:                                         ErrUpdateDownload,
		{ProxyStart, "something odd"}:                                           ErrCoreStart,
		{"x.y", ""}:                                                             ErrUnknown,
	}
	for in, want := range cases {
		if got := Classify(in[0], in[1]); got != want {
			t.Errorf("Classify(%q,%q)=%s want %s", in[0], in[1], got, want)
		}
	}
}

func TestSpoolRotationAndCap(t *testing.T) {
	dir := t.TempDir()
	sp, err := OpenSpool(dir, "s1", 1024, 4096)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		if err := sp.Append(record{K: "l", T: int64(i), S: strings.Repeat("x", 60)}); err != nil {
			t.Fatal(err)
		}
	}
	_ = sp.Seal()
	segs := sp.Segments()
	if len(segs) < 2 {
		t.Fatalf("expected rotation, got %d segments", len(segs))
	}
	var total int64
	for _, p := range segs {
		st, _ := os.Stat(p)
		total += st.Size()
	}
	if total > 4096 {
		t.Fatalf("cap exceeded: %d", total)
	}
	// newest data survives, oldest went first
	recs, _ := readSegment(segs[len(segs)-1])
	if len(recs) == 0 || recs[len(recs)-1].T != 199 {
		t.Fatalf("newest segment lost: %+v", recs)
	}
	if segmentSession(segs[0]) != "s1" {
		t.Fatalf("session %q", segmentSession(segs[0]))
	}
}

func TestSpoolSealsCrashLeftovers(t *testing.T) {
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "old", 1<<20, 1<<20)
	_ = sp.Append(record{K: "l", T: 1, S: "before crash"})
	sp.Close() // simulated crash: the process dies, its handle is released, the segment is never sealed
	sp2, _ := OpenSpool(dir, "new", 1<<20, 1<<20)
	segs := sp2.Segments()
	if len(segs) != 1 || segmentSession(segs[0]) != "old" {
		t.Fatalf("leftover not sealed: %v", segs)
	}
}

func TestUploaderBatchingAndBackoff(t *testing.T) {
	var calls, fail atomic.Int32
	var got Batch
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Content-Encoding") != "gzip" || r.Header.Get("X-Device-Id") != "dev" || r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(400)
			return
		}
		if fail.Load() > 0 {
			fail.Add(-1)
			w.WriteHeader(503)
			return
		}
		zr, _ := gzip.NewReader(r.Body)
		_ = json.NewDecoder(zr).Decode(&got)
		w.WriteHeader(200)
	}))
	defer srv.Close()
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 1<<20)
	_ = sp.Append(record{K: "e", E: &Event{EventID: "e1", Type: ProxyStart, Status: Fail}})
	_ = sp.Append(record{K: "l", T: 1000, S: "line one"})
	_ = sp.Append(record{K: "l", T: 2000, S: "line two"})
	_ = sp.Seal()

	now := time.Unix(1000, 0)
	u := &Uploader{Endpoint: srv.URL, Client: srv.Client(), Meta: func() Meta { return Meta{DeviceID: "dev", AppVersion: "1.0.0"} }, Token: func() string { return "tok" }, MinWait: 30 * time.Second, MaxWait: 10 * time.Minute, now: func() time.Time { return now }}
	fail.Store(2)
	if u.Drain(t.Context(), sp.Segments(), 10) != 0 || u.Ready() {
		t.Fatal("first failure must back off")
	}
	first := u.nextAfter.Sub(now)
	if first < 24*time.Second || first > 36*time.Second {
		t.Fatalf("first backoff %v", first)
	}
	if u.Drain(t.Context(), sp.Segments(), 10) != 0 || calls.Load() != 1 {
		t.Fatal("must not send during backoff")
	}
	now = u.nextAfter
	u.Drain(t.Context(), sp.Segments(), 10)
	if second := u.nextAfter.Sub(now); second < 48*time.Second {
		t.Fatalf("backoff did not grow: %v", second)
	}
	now = u.nextAfter
	if u.Drain(t.Context(), sp.Segments(), 10) != 1 {
		t.Fatal("upload after backoff failed")
	}
	if len(sp.Segments()) != 0 || u.failures != 0 {
		t.Fatal("sent segment must be deleted and backoff reset")
	}
	if got.SchemaVersion != SchemaVersion || len(got.Events) != 1 || len(got.Logs) != 1 || got.Logs[0].LineCount != 2 || got.Logs[0].SessionID != "sess" {
		t.Fatalf("batch %+v", got)
	}
	for i := 0; i < 30; i++ {
		u.backoff()
	}
	if u.nextAfter.Sub(now) > 12*time.Minute {
		t.Fatal("backoff must be capped")
	}
}

func TestEmitEndToEnd(t *testing.T) {
	got := make(chan Batch, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		zr, _ := gzip.NewReader(r.Body)
		var b Batch
		_ = json.NewDecoder(zr).Decode(&b)
		got <- b
	}))
	defer srv.Close()
	dir := t.TempDir()
	if err := Init(Config{DataDir: dir, Endpoint: srv.URL, Meta: func() Meta { return Meta{DeviceID: "d"} }, Interval: time.Hour}); err != nil {
		t.Fatal(err)
	}
	defer Close()
	Log("[core] sing-box TUN up (rule) via node password=abc")
	time.Sleep(100 * time.Millisecond)
	Op(ProxyStart, time.Now(), Errorf("dial tcp: i/o timeout vless://x@y"), map[string]any{"protocol": "vless"})
	select {
	case b := <-got:
		var start *Event
		for i := range b.Events {
			if b.Events[i].Type == ProxyStart {
				start = &b.Events[i]
			}
		}
		if start == nil || start.ErrorCode != ErrNodeTimeout || strings.Contains(start.ErrorText, "x@y") || start.DurationMs == nil {
			t.Fatalf("event %+v", b.Events)
		}
		if len(b.Logs) != 1 || strings.Contains(b.Logs[0].Text, "abc") {
			t.Fatalf("logs %+v", b.Logs)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("failure event did not trigger an immediate upload")
	}
	if _, err := os.Stat(filepath.Join(dir, "telemetry")); err != nil {
		t.Fatal(err)
	}
}

func TestDisabledByEnv(t *testing.T) {
	t.Setenv("PROXYSPLIT_TELEMETRY", "off")
	if err := Init(Config{DataDir: t.TempDir(), Endpoint: "http://x"}); err != nil || active.Load() != nil {
		t.Fatal("kill switch ignored")
	}
	Emit(AppStart, Info, nil, nil) // no-op, must not panic
}
