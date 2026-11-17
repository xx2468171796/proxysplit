package telemetry

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// "Clear the local log queue" means the logs are thrown away. It used to
// upload them first — the opposite of what the user asked for.
func TestPurgeDeletesWithoutUploading(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	if err := Init(Config{DataDir: dir, Endpoint: cs.URL, Meta: func() Meta { return Meta{DeviceID: "d"} }, Interval: time.Hour}); err != nil {
		t.Fatal(err)
	}
	defer Close()
	r := active.Load()
	spool := filepath.Join(dir, "telemetry")
	// Three kinds of files: sealed, quarantined, and the one being written.
	_ = r.spool.Append(record{K: "l", T: 1, S: "[service] sealed line"})
	_ = r.spool.Seal()
	_ = r.spool.Append(record{K: "l", T: 2, S: "[service] rejected line"})
	_ = r.spool.Seal()
	r.spool.Quarantine(r.spool.Segments()[1])
	_ = r.spool.Append(record{K: "l", T: 3, S: "[service] current line"})
	_ = r.spool.Flush()
	if globCount(t, spool, "*.jsonl") != 3 {
		t.Fatalf("setup: want 3 spool files, have %d", globCount(t, spool, "*.jsonl"))
	}

	if removed := Purge(dir); removed != 3 {
		t.Fatalf("Purge removed %d files, want 3", removed)
	}
	if globCount(t, spool, "*.jsonl") != 0 {
		t.Fatal("spool must be empty after Purge")
	}
	if cs.requests != 0 {
		t.Fatalf("Purge uploaded %d requests; it must upload nothing", cs.requests)
	}

	// The recorder keeps working afterwards.
	_ = r.spool.Append(record{K: "l", T: 4, S: "[service] after purge"})
	_ = r.spool.Seal()
	if len(r.spool.Segments()) != 1 {
		t.Fatal("spool must accept records after a purge")
	}
}

func TestPurgeWithRecorderOff(t *testing.T) {
	dir := t.TempDir()
	spool := filepath.Join(dir, "telemetry")
	_ = os.MkdirAll(spool, 0o755)
	for _, name := range []string{"device.dat", "control-api.json", "config.json"} {
		_ = os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600)
	}
	for _, name := range []string{"seg-1-a.jsonl", "cur-b.jsonl", "bad-2-c.jsonl"} {
		_ = os.WriteFile(filepath.Join(spool, name), []byte("{}\n"), 0o600)
	}
	if removed := Purge(dir); removed != 3 || globCount(t, spool, "*.jsonl") != 0 {
		t.Fatalf("removed %d", removed)
	}
	// Only the queue goes: identity and control files in the data dir stay.
	for _, name := range []string{"device.dat", "control-api.json", "config.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("%s must survive a log-queue purge: %v", name, err)
		}
	}
}

// A drain that already picked its segments must not send them once they have
// been purged.
func TestDrainSkipsSegmentsPurgedMeanwhile(t *testing.T) {
	cs := newContractServer(t)
	dir := t.TempDir()
	sp, _ := OpenSpool(dir, "sess", 1<<20, 8<<20)
	sealedSegments(t, sp, 3, oneLine)
	u := cs.uploader(sp)
	meta := clampMeta(u.Meta())
	group := nextGroup(meta, sp.Segments()) // the drain has read them …
	sp.Purge()                              // … then the user clears the queue
	if res := u.send(t.Context(), meta, group); res != accepted || cs.requests != 0 {
		t.Fatalf("purged segments were uploaded (%d requests)", cs.requests)
	}
}
