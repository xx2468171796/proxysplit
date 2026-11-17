package telemetry

import (
	"context"
	"os"
	"path/filepath"
)

// Purge deletes the local log queue — the segment being written, the sealed
// ones and the quarantined ones — WITHOUT uploading any of it (the reset
// center's 本地日志队列: clearing means discarding). dataDir is used when the
// recorder is off (dev builds, opted out). Returns how many files were deleted.
//
// A request that is already on the wire cannot be recalled, but a running
// drain sends nothing further: it skips segments that no longer exist.
func Purge(dataDir string) (removed int) {
	if r := active.Load(); r != nil {
		return r.spool.Purge()
	}
	return purgeDir(filepath.Join(dataDir, "telemetry"))
}

// FlushAndPurge is the old name of Purge and no longer uploads anything
// (sent is always 0).
//
// Deprecated: call Purge. Kept only until app_reset.go (owned by another
// change set) is switched over; delete it in that same change.
func FlushAndPurge(_ context.Context, dataDir string) (sent, removed int) {
	return 0, Purge(dataDir)
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
