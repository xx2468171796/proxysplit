package coreupdate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// The previous core is kept next to the new one after a panel install
// (InstallRelease) so the caller can restart the proxy with the new core and,
// if that start fails, put the old one back:
//
//	sing-box.exe.old           previous executable
//	sing-box.version.json.old  its version marker (absent if it had none)
//
// ClearBackup drops both once the new core is known good (or nothing runs).

// ErrBackupBusy means a leftover sing-box.exe.old could not be deleted,
// normally because a core process started from it is still running.
var ErrBackupBusy = errors.New("旧内核文件仍被占用，重启软件后再更新")

const failedSuffix = ".failed"

func backupPath(dir string) string       { return filepath.Join(dir, SingBoxExe+".old") }
func markerBackupPath(dir string) string { return filepath.Join(dir, markerFile+".old") }

// releaseWait bounds how long rename / remove retry while Windows still holds
// the image of a core process that has just exited.
var releaseWait = 3 * time.Second

func retry(op func() error) error {
	deadline := time.Now().Add(releaseWait)
	for {
		err := op()
		if err == nil || os.IsNotExist(err) || time.Now().After(deadline) {
			return err
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// HasBackup reports whether a previous core is kept for Rollback.
func HasBackup(dir string) bool {
	st, err := os.Stat(backupPath(dir))
	return err == nil && st.Mode().IsRegular()
}

// ClearBackup deletes the kept previous core and its marker. It returns
// ErrBackupBusy (wrapped) when the executable is still locked.
func ClearBackup(dir string) error {
	installMu.Lock()
	defer installMu.Unlock()
	return clearBackupLocked(dir)
}

func clearBackupLocked(dir string) error {
	if err := retry(func() error { return os.Remove(backupPath(dir)) }); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("%w: %v", ErrBackupBusy, err)
	}
	_ = os.Remove(markerBackupPath(dir))
	return nil
}

// backupMarkerLocked copies the current marker aside before an install so
// Rollback restores the exact version string of the previous core.
func backupMarkerLocked(dir string) {
	raw, err := os.ReadFile(filepath.Join(dir, markerFile))
	if err != nil {
		_ = os.Remove(markerBackupPath(dir))
		return
	}
	_ = os.WriteFile(markerBackupPath(dir), raw, 0o644)
}

// Rollback puts the previous core back in place of a newly installed one that
// failed to start. The caller must have stopped the core first. The failed
// executable is discarded; on any error the installed file is left usable.
func Rollback(dir string) error {
	installMu.Lock()
	defer installMu.Unlock()
	if !HasBackup(dir) {
		return fmt.Errorf("没有可换回的旧内核")
	}
	dst := filepath.Join(dir, SingBoxExe)
	failed := dst + failedSuffix
	_ = os.Remove(failed)
	moved := false
	if err := retry(func() error { return os.Rename(dst, failed) }); err == nil {
		moved = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("移开新内核失败：%w", err)
	}
	if err := retry(func() error { return os.Rename(backupPath(dir), dst) }); err != nil {
		if moved {
			_ = os.Rename(failed, dst)
		}
		return fmt.Errorf("换回旧内核失败：%w", err)
	}
	_ = os.Remove(failed)
	marker := filepath.Join(dir, markerFile)
	if err := os.Rename(markerBackupPath(dir), marker); err != nil {
		// The previous core had no marker: drop the new one so the version is
		// read from the executable again instead of being misreported.
		_ = os.Remove(marker)
	}
	return nil
}
