package xray

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// exeRunning reports whether any process with image name exe exists (one
// Toolhelp snapshot, a few milliseconds). On error it says true so the caller
// falls back to the precise PowerShell check.
func exeRunning(exe string) bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return true
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if err := windows.Process32First(snap, &e); err != nil {
		return true
	}
	for {
		if strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), exe) {
			return true
		}
		if err := windows.Process32Next(snap, &e); err != nil {
			return false
		}
	}
}
