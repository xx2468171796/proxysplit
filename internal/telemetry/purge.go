package telemetry

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

// FlushAndPurge seals the current segment, uploads as much of the spool as it
// can before ctx ends, then deletes what is left (the reset center's 本地日志
// 队列). dataDir is used when the recorder is off (dev builds, opted out).
// Returns how many segments were uploaded and how many were deleted unsent.
func FlushAndPurge(ctx context.Context, dataDir string) (sent, removed int) {
	r := active.Load()
	if r == nil {
		return 0, purgeDir(filepath.Join(dataDir, "telemetry"))
	}
	// Wait for the background drain to finish so the Uploader is ours.
	for !r.uploading.CompareAndSwap(false, true) {
		select {
		case <-ctx.Done():
			return 0, 0
		case <-time.After(100 * time.Millisecond):
		}
	}
	defer r.uploading.Store(false)
	_ = r.spool.Seal()
	segs := r.spool.Segments()
	sent = r.up.Drain(ctx, segs, len(segs))
	for _, p := range r.spool.Segments() {
		if os.Remove(p) == nil {
			removed++
		}
	}
	return sent, removed
}

func purgeDir(dir string) (removed int) {
	list, _ := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	for _, p := range list {
		if os.Remove(p) == nil {
			removed++
		}
	}
	return removed
}
