package telemetry

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// sealedSegments writes n sealed segments, each with the given records.
func sealedSegments(t *testing.T, sp *Spool, n int, recs func(i int) []record) {
	t.Helper()
	base := time.Unix(1_700_000_000, 0)
	for i := 0; i < n; i++ {
		sp.now = func() time.Time { return base.Add(time.Duration(i) * time.Second) }
		for _, r := range recs(i) {
			if err := sp.Append(r); err != nil {
				t.Fatal(err)
			}
		}
		if err := sp.Seal(); err != nil {
			t.Fatal(err)
		}
	}
}

func oneLine(i int) []record {
	return []record{{K: "l", T: int64(1000 + i), S: fmt.Sprintf("[service] line %d", i)}}
}

// While the uploader is backing off (offline), the 60 s tick and every
// failure event used to seal a new tiny segment: 1400+ files a day and one
// request per file once the network came back.
func TestNoSealWhileUploaderBacksOff(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	now := time.Unix(1000, 0)
	u := cs.uploader(sp)
	u.now = func() time.Time { return now }
	r := &recorder{spool: sp, up: u, ctx: context.Background()}

	u.backoff()                // the last upload failed
	for i := 0; i < 200; i++ { // ticks and failure-event kicks while offline
		_ = sp.Append(oneLine(i)[0])
		r.upload()
	}
	r.upWG.Wait()
	if n := globCount(t, dir, "seg-*.jsonl"); n != 0 || cs.requests != 0 {
		t.Fatalf("backing off: %d segments sealed, %d requests sent; want none", n, cs.requests)
	}

	now = now.Add(time.Hour) // back online
	r.upload()
	r.upWG.Wait()
	if cs.requests != 1 || globCount(t, dir, "*.jsonl") != 0 {
		t.Fatalf("after the backoff everything goes in one request: %d requests, %d files left", cs.requests, globCount(t, dir, "*.jsonl"))
	}
	if got := cs.accepted[0].Logs[0].LineCount; got != 200 {
		t.Fatalf("all 200 lines must arrive, got %d", got)
	}
}

func TestDrainMergesSmallSegments(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	sealedSegments(t, sp, 30, oneLine)

	if sent := cs.uploader(sp).Drain(t.Context(), sp.Segments(), 20); sent != 30 {
		t.Fatalf("sent %d of 30 segments", sent)
	}
	if cs.requests != 1 {
		t.Fatalf("30 tiny segments must share one request, got %d", cs.requests)
	}
	ids := map[string]bool{}
	for _, c := range cs.accepted[0].Logs {
		ids[c.ChunkID] = true
	}
	if len(ids) != 30 || globCount(t, dir, "*.jsonl") != 0 {
		t.Fatalf("each segment keeps its own chunk id (%d distinct) and is removed", len(ids))
	}
}

func TestMergeStopsAtContractAndSizeLimits(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 8<<20, 64<<20)
	// 120 one-chunk segments: at most limitBatchLogs chunks per request.
	sealedSegments(t, sp, 120, oneLine)
	u := cs.uploader(sp)
	if sent := u.Drain(t.Context(), sp.Segments(), 20); sent != 120 || cs.requests != 3 {
		t.Fatalf("120 segments → 3 requests of ≤ %d chunks; got %d sent in %d requests", limitBatchLogs, sent, cs.requests)
	}

	// Three segments of ~300 KB: two together exceed mergeBytes, so one request each.
	cs.requests = 0
	big := func(i int) []record {
		var out []record
		for j := 0; j < 300; j++ {
			out = append(out, record{K: "l", T: int64(j), S: fmt.Sprintf("%d-%d %s", i, j, strings.Repeat("payload ", 120))})
		}
		return out
	}
	sealedSegments(t, sp, 3, big)
	if sent := u.Drain(t.Context(), sp.Segments(), 20); sent != 3 || cs.requests != 3 {
		t.Fatalf("large segments are not merged past mergeBytes: sent %d in %d requests", sent, cs.requests)
	}
}

func TestDrainLimitsRequestsPerRound(t *testing.T) {
	cs := newContractServer(t)
	sp, _ := OpenSpool(t.TempDir(), "sess", 1<<20, 8<<20)
	sealedSegments(t, sp, 120, oneLine)
	if sent := cs.uploader(sp).Drain(t.Context(), sp.Segments(), 2); cs.requests != 2 || sent != 2*limitBatchLogs {
		t.Fatalf("max 2 requests per round: %d requests, %d segments", cs.requests, sent)
	}
}

// One bad segment inside a merged request must not take its neighbours down.
func TestMergedRejectFallsBackToSingleSegments(t *testing.T) {
	cs := newContractServer(t)
	cs.reject = func(b Batch) bool {
		for _, c := range b.Logs {
			if strings.Contains(c.Text, "poison") {
				return true
			}
		}
		return false
	}
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	sealedSegments(t, sp, 5, func(i int) []record {
		if i == 2 {
			return []record{{K: "l", T: 1, S: "poison"}}
		}
		return oneLine(i)
	})
	u := cs.uploader(sp)
	if sent := u.Drain(t.Context(), sp.Segments(), 20); sent != 4 || !u.Ready() {
		t.Fatalf("4 healthy segments must be delivered, got %d", sent)
	}
	if globCount(t, dir, "seg-*.jsonl") != 0 || globCount(t, dir, "bad-*.jsonl") != 1 {
		t.Fatal("only the poisoned segment is quarantined")
	}
	lines := 0
	for _, b := range cs.accepted {
		for _, c := range b.Logs {
			lines += c.LineCount
		}
	}
	if lines != 4 {
		t.Fatalf("server must hold the 4 healthy lines, has %d", lines)
	}
}
