package proc

import (
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modversion                 = windows.NewLazySystemDLL("version.dll")
	procGetFileVersionInfoSize = modversion.NewProc("GetFileVersionInfoSizeW")
	procGetFileVersionInfo     = modversion.NewProc("GetFileVersionInfoW")
	procVerQueryValue          = modversion.NewProc("VerQueryValueW")
)

// fileDescription reads the FileDescription string (e.g. "Google Chrome",
// "Microsoft Edge") from an executable's version resource. Best-effort: returns
// "" when the file has no version info or on any error.
func fileDescription(path string) string {
	p16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	var handle uint32
	size, _, _ := procGetFileVersionInfoSize.Call(uintptr(unsafe.Pointer(p16)), uintptr(unsafe.Pointer(&handle)))
	if size == 0 {
		return ""
	}
	buf := make([]byte, size)
	if r, _, _ := procGetFileVersionInfo.Call(uintptr(unsafe.Pointer(p16)), 0, size, uintptr(unsafe.Pointer(&buf[0]))); r == 0 {
		return ""
	}

	// Pick the first language/codepage translation.
	tq, _ := windows.UTF16PtrFromString(`\VarFileInfo\Translation`)
	var tptr unsafe.Pointer
	var tlen uint32
	if r, _, _ := procVerQueryValue.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(tq)),
		uintptr(unsafe.Pointer(&tptr)),
		uintptr(unsafe.Pointer(&tlen)),
	); r == 0 || tlen < 4 || tptr == nil {
		return ""
	}
	lang := *(*uint16)(tptr)
	cp := *(*uint16)(unsafe.Pointer(uintptr(tptr) + 2))

	sub := fmt.Sprintf(`\StringFileInfo\%04x%04x\FileDescription`, lang, cp)
	sq, _ := windows.UTF16PtrFromString(sub)
	var dptr unsafe.Pointer
	var dlen uint32
	if r, _, _ := procVerQueryValue.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(sq)),
		uintptr(unsafe.Pointer(&dptr)),
		uintptr(unsafe.Pointer(&dlen)),
	); r == 0 || dlen == 0 || dptr == nil {
		return ""
	}
	s := windows.UTF16ToString(unsafe.Slice((*uint16)(dptr), dlen))
	return strings.TrimSpace(s)
}
