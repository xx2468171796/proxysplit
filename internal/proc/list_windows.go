package proc

import (
	"sort"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ProcInfo is one running executable, aggregated by image path (so two programs
// that happen to share an exe name — e.g. a test Chromium and Google Chrome —
// appear as separate, distinguishable entries).
type ProcInfo struct {
	Name  string `json:"name"`  // e.g. "chrome.exe"
	Desc  string `json:"desc"`  // friendly name from version info, e.g. "Google Chrome"
	Path  string `json:"path"`  // full image path (best-effort, may be empty)
	Count int    `json:"count"` // number of live processes for this exe
}

// ListProcesses returns the set of currently running executables, de-duplicated
// by full image path (falling back to name when the path is unreadable) and
// sorted by friendly name. Paths are best-effort (some protected processes deny
// access).
func ListProcesses() ([]ProcInfo, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)

	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if err := windows.Process32First(snap, &e); err != nil {
		return nil, err
	}

	byKey := map[string]*ProcInfo{}
	for {
		name := strings.ToLower(windows.UTF16ToString(e.ExeFile[:]))
		pid := e.ProcessID
		if name != "" && name != "system idle process" && name != "system" && pid != 0 {
			path := ""
			if p, err := exePath(pid); err == nil {
				path = p
			}
			key := strings.ToLower(path)
			if key == "" {
				key = "name:" + name // group unresolvable ones by name
			}
			pi := byKey[key]
			if pi == nil {
				pi = &ProcInfo{Name: name, Path: path}
				if path != "" {
					pi.Desc = fileDescription(path)
				}
				byKey[key] = pi
			}
			pi.Count++
		}
		if err := windows.Process32Next(snap, &e); err != nil {
			break // ERROR_NO_MORE_FILES
		}
	}

	out := make([]ProcInfo, 0, len(byKey))
	for _, pi := range byKey {
		out = append(out, *pi)
	}
	sort.Slice(out, func(i, j int) bool {
		li := displayLabel(out[i])
		lj := displayLabel(out[j])
		if li == lj {
			return out[i].Path < out[j].Path
		}
		return li < lj
	})
	return out, nil
}

func displayLabel(p ProcInfo) string {
	if p.Desc != "" {
		return strings.ToLower(p.Desc)
	}
	return p.Name
}
