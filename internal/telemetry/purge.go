package telemetry

import (
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

func purgeDir(dir string) (removed int) {
	list, _ := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	for _, p := range list {
		if os.Remove(p) == nil {
			removed++
		}
	}
	return removed
}
