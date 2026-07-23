// Package proc resolves process image paths on Windows for the rule matcher and
// the app picker.
package proc

import (
	"strings"

	"golang.org/x/sys/windows"
)

// exePath returns the full image path for a PID.
func exePath(pid uint32) (string, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf[:size]), nil
}

// BaseName returns the lowercased final path element, e.g. "code.exe".
func BaseName(p string) string {
	p = strings.ReplaceAll(p, "/", "\\")
	if i := strings.LastIndex(p, "\\"); i >= 0 {
		p = p[i+1:]
	}
	return strings.ToLower(p)
}
