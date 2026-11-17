package telemetry

import (
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// contractServer answers like the real endpoint: 400 when the batch breaks
// the contract (or when reject says so), 200 otherwise. It keeps what it
// accepted.
type contractServer struct {
	*httptest.Server
	mu       sync.Mutex
	requests int
	accepted []Batch
	reject   func(Batch) bool
}

func newContractServer(t *testing.T) *contractServer {
	cs := &contractServer{}
	cs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b Batch
		zr, err := gzip.NewReader(r.Body)
		if err == nil {
			err = json.NewDecoder(zr).Decode(&b)
		}
		cs.mu.Lock()
		defer cs.mu.Unlock()
		cs.requests++
		if err != nil || len(contractViolations(b)) > 0 || (cs.reject != nil && cs.reject(b)) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		cs.accepted = append(cs.accepted, b)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(cs.Close)
	return cs
}

func (cs *contractServer) uploader(sp *Spool) *Uploader {
	return &Uploader{Endpoint: cs.URL, Client: cs.Client(), Quarantine: sp.Quarantine, MinWait: 30 * time.Second, MaxWait: 10 * time.Minute,
		Meta: func() Meta { return Meta{DeviceID: strings.Repeat("a", 64), AppVersion: "1.12.5"} }}
}

func goodEvent(typ string) *Event {
	return &Event{EventID: NewUUID(), SessionID: "sess", Seq: 1, TS: time.Now().UTC().Format(time.RFC3339Nano), Type: typ, Status: Fail, ErrorCode: ErrCoreStart}
}

func globCount(t *testing.T, dir, pattern string) int {
	t.Helper()
	list, _ := filepath.Glob(filepath.Join(dir, pattern))
	return len(list)
}

// The audit case: an error text longer than the server allows used to get the
// whole batch a 400, and the client then deleted the segment — losing exactly
// the log lines around the failure.
func TestOversizedErrorTextNoLongerLosesTheSegment(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	ev := goodEvent(ProxyStart)
	ev.ErrorText = strings.Repeat("e", 4096) + "…[truncated]" // what a pre-fix client spooled
	_ = sp.Append(record{K: "l", T: 1000, S: "[service] starting"})
	_ = sp.Append(record{K: "e", E: ev})
	_ = sp.Append(record{K: "l", T: 2000, S: "[error] create tun: Access is denied."})
	_ = sp.Seal()

	if sent := cs.uploader(sp).Drain(t.Context(), sp.Segments(), 10); sent != 1 {
		t.Fatalf("sent %d segments, want 1", sent)
	}
	if len(cs.accepted) != 1 || len(cs.accepted[0].Events) != 1 || cs.accepted[0].Logs[0].LineCount != 2 {
		t.Fatalf("server must receive the event and both log lines: %+v", cs.accepted)
	}
	if globCount(t, dir, "*.jsonl") != 0 {
		t.Fatal("an uploaded segment is removed")
	}
}

func TestRejectedSegmentIsRetriedStrictOnce(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	_ = sp.Append(record{K: "e", E: goodEvent("Bad Type")}) // the server refuses the whole batch for this
	_ = sp.Append(record{K: "e", E: goodEvent(ProxyStart)})
	_ = sp.Append(record{K: "l", T: 1000, S: "[service] line kept"})
	_ = sp.Seal()

	u := cs.uploader(sp)
	if sent := u.Drain(t.Context(), sp.Segments(), 10); sent != 1 || !u.Ready() {
		t.Fatalf("strict retry must deliver the segment without backing off (sent %d)", sent)
	}
	if cs.requests != 2 || len(cs.accepted) != 1 {
		t.Fatalf("want one rejected and one accepted request, got %d requests / %d accepted", cs.requests, len(cs.accepted))
	}
	got := cs.accepted[0]
	if len(got.Events) != 1 || got.Events[0].Type != ProxyStart || !strings.Contains(got.Logs[0].Text, "line kept") {
		t.Fatalf("strict retry keeps everything valid: %+v", got)
	}
	if globCount(t, dir, "*.jsonl") != 0 {
		t.Fatal("delivered segment must be removed")
	}
}

func TestStillRejectedSegmentIsQuarantinedNotDeleted(t *testing.T) {
	cs := newContractServer(t)
	cs.reject = func(b Batch) bool { return len(b.Logs) > 0 && strings.Contains(b.Logs[0].Text, "poison") }
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	_ = sp.Append(record{K: "l", T: 1000, S: "poison line the server never accepts"})
	_ = sp.Seal()
	time.Sleep(2 * time.Millisecond)
	_ = sp.Append(record{K: "l", T: 2000, S: "healthy line"})
	_ = sp.Seal()

	u := cs.uploader(sp)
	if sent := u.Drain(t.Context(), sp.Segments(), 10); sent != 1 || !u.Ready() {
		t.Fatalf("the queue must move on past a bad segment (sent %d, ready %v)", sent, u.Ready())
	}
	if cs.requests != 3 {
		t.Fatalf("bad segment: normal + strict attempt, then the healthy one = 3 requests, got %d", cs.requests)
	}
	if globCount(t, dir, "seg-*.jsonl") != 0 || globCount(t, dir, "bad-*.jsonl") != 1 {
		t.Fatalf("rejected segment must be set aside as bad-*: seg %d bad %d", globCount(t, dir, "seg-*.jsonl"), globCount(t, dir, "bad-*.jsonl"))
	}
	if cs.requests = 0; u.Drain(t.Context(), sp.Segments(), 10) != 0 || cs.requests != 0 {
		t.Fatal("a quarantined segment is never sent again")
	}
}

func TestQuarantineKeepsOnlyTheNewest(t *testing.T) {
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	for i := 0; i < quarantineKeep+3; i++ {
		_ = sp.Append(record{K: "l", T: int64(i), S: "x"})
		_ = sp.Seal()
		time.Sleep(2 * time.Millisecond)
	}
	for _, p := range sp.Segments() {
		sp.Quarantine(p)
	}
	if n := globCount(t, dir, "bad-*.jsonl"); n != quarantineKeep {
		t.Fatalf("kept %d quarantined segments, want %d", n, quarantineKeep)
	}
}
