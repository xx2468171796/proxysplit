//go:build windows

// Package shortcut keeps a desktop shortcut to the running executable.
package shortcut

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// EnsureDesktop creates (or repairs) the current user's desktop shortcut
// "<name>.lnk" pointing at exePath. It is cheap to call on every launch: an
// existing shortcut that already points at exePath is left untouched, a
// deleted one is recreated and a stale target (the exe moved) is corrected.
func EnsureDesktop(name, exePath string) error {
	_, err := ensureIn("", name, exePath, false)
	return err
}

// RefreshDesktop rewrites the desktop shortcut even when it already points at
// exePath, then tells Explorer to drop its cached icons. Call it once after an
// update: the exe icon may have changed, and the icon cache otherwise keeps
// showing the old picture on the desktop until Windows happens to rebuild it.
func RefreshDesktop(name, exePath string) error {
	lnk, err := ensureIn("", name, exePath, true)
	if err != nil {
		return err
	}
	notifyIconChanged(lnk)
	return nil
}

var (
	shell32            = windows.NewLazySystemDLL("shell32.dll")
	procSHChangeNotify = shell32.NewProc("SHChangeNotify")
)

const (
	shcneUpdateItem   = 0x00002000
	shcneAssocChanged = 0x08000000
	shcnfIDList       = 0x0000
	shcnfPathW        = 0x0005
)

// notifyIconChanged asks the shell to repaint the shortcut and flush cached
// icons (SHCNE_ASSOCCHANGED is what installers send after an icon changes).
func notifyIconChanged(lnk string) {
	if p, err := windows.UTF16PtrFromString(lnk); err == nil {
		procSHChangeNotify.Call(shcneUpdateItem, shcnfPathW, uintptr(unsafe.Pointer(p)), 0)
		runtime.KeepAlive(p)
	}
	procSHChangeNotify.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}

// ensureIn does the work; dir "" means the user's desktop (the known folder,
// so a Desktop redirected to OneDrive or another drive is followed).
//
// The shortcut is written through the Unicode IShellLinkW COM interface
// directly: WScript.Shell goes through the ANSI code page and fails on paths
// with characters it cannot represent (ß, emoji… on Chinese Windows), and
// passing paths through a PowerShell script needs quoting that typographic
// quotes break.
// force rewrites the shortcut even when its target is already exePath. It
// returns the shortcut's path.
func ensureIn(dir, name, exePath string, force bool) (string, error) {
	exePath, err := filepath.Abs(exePath)
	if err != nil {
		return "", err
	}
	// Windows stores the long form (C:\Users\Administrator, not ADMINI~1);
	// compare in that form or an up-to-date shortcut is rewritten every launch.
	exePath = LongPath(exePath)
	if dir == "" {
		if dir, err = windows.KnownFolderPath(windows.FOLDERID_Desktop, 0); err != nil {
			return "", fmt.Errorf("desktop folder: %w", err)
		}
	}
	lnk := filepath.Join(dir, name+".lnk")

	return lnk, withCOM(func() error {
		link, err := newShellLink()
		if err != nil {
			return err
		}
		defer link.release()
		if current, err := link.loadTarget(lnk); !force && err == nil && strings.EqualFold(current, exePath) {
			return nil
		}
		return link.save(lnk, exePath, filepath.Dir(exePath), name)
	})
}

// ReadTarget returns the target path stored in a .lnk file.
func ReadTarget(lnk string) (string, error) {
	var target string
	err := withCOM(func() error {
		link, err := newShellLink()
		if err != nil {
			return err
		}
		defer link.release()
		target, err = link.loadTarget(lnk)
		return err
	})
	return target, err
}

// LongPath expands 8.3 short names (ADMINI~1) to the long path when it exists.
func LongPath(p string) string {
	src, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return p
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	if n, err := windows.GetLongPathName(src, &buf[0], uint32(len(buf))); err == nil && n > 0 && int(n) < len(buf) {
		return windows.UTF16ToString(buf[:n])
	}
	return p
}

// --- minimal COM plumbing for IShellLinkW / IPersistFile ---

var (
	ole32                = windows.NewLazySystemDLL("ole32.dll")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")

	clsidShellLink  = windows.GUID{Data1: 0x00021401, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidIShellLinkW  = windows.GUID{Data1: 0x000214F9, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidIPersistFile = windows.GUID{Data1: 0x0000010B, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
)

// vtable slots (IUnknown: 0 QueryInterface, 1 AddRef, 2 Release).
const (
	slRelease          = 2
	slGetPath          = 3
	slSetDescription   = 7
	slSetWorkingDir    = 9
	slSetIconLocation  = 17
	slSetPath          = 20
	pfQueryInterface   = 0
	pfLoad             = 5
	pfSave             = 6
	clsctxInprocServer = 0x1
	stgmRead           = 0
	slgpRawPath        = 0x4
)

// withCOM runs fn on a locked OS thread with COM initialised (apartment
// threaded, as the shell objects require).
func withCOM(fn func() error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED)
	switch {
	case err == nil, errors.Is(err, syscall.Errno(windows.S_FALSE)):
		defer windows.CoUninitialize()
	case errors.Is(err, syscall.Errno(windows.RPC_E_CHANGED_MODE)):
		// already initialised differently on this thread; usable as is
	default:
		return fmt.Errorf("CoInitializeEx: %w", err)
	}
	return fn()
}

// comObject is a COM interface pointer; its first word points at the vtable.
type comObject struct{ p unsafe.Pointer }

func (o comObject) call(slot int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(o.p)
	fn := *(*uintptr)(unsafe.Add(vtbl, slot*int(unsafe.Sizeof(uintptr(0)))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(o.p)}, args...)...)
	return r
}

func (o comObject) release() { o.call(slRelease) }

func hresult(what string, hr uintptr) error {
	if int32(hr) < 0 {
		return fmt.Errorf("%s: HRESULT 0x%08X", what, uint32(hr))
	}
	return nil
}

type shellLink struct{ link, file comObject }

func newShellLink() (*shellLink, error) {
	var link comObject
	hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIShellLinkW)), uintptr(unsafe.Pointer(&link.p)))
	if err := hresult("CoCreateInstance(ShellLink)", hr); err != nil {
		return nil, err
	}
	var file comObject
	if err := hresult("QueryInterface(IPersistFile)", link.call(pfQueryInterface, uintptr(unsafe.Pointer(&iidIPersistFile)), uintptr(unsafe.Pointer(&file.p)))); err != nil {
		link.release()
		return nil, err
	}
	return &shellLink{link: link, file: file}, nil
}

func (s *shellLink) release() {
	s.file.release()
	s.link.release()
}

func (s *shellLink) loadTarget(lnk string) (string, error) {
	p, err := windows.UTF16PtrFromString(lnk)
	if err != nil {
		return "", err
	}
	defer runtime.KeepAlive(p)
	if err := hresult("IPersistFile.Load", s.file.call(pfLoad, uintptr(unsafe.Pointer(p)), stgmRead)); err != nil {
		return "", err
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	defer runtime.KeepAlive(buf)
	if err := hresult("IShellLinkW.GetPath", s.link.call(slGetPath, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, slgpRawPath)); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf), nil
}

func (s *shellLink) save(lnk, target, workDir, description string) error {
	// Keep the *uint16 values referenced until every call has returned: a
	// pointer only held as uintptr does not keep its buffer alive.
	var ptrs [4]*uint16
	for i, v := range []string{target, workDir, description, lnk} {
		p, err := windows.UTF16PtrFromString(v)
		if err != nil {
			return err
		}
		ptrs[i] = p
	}
	defer runtime.KeepAlive(ptrs)
	up := func(i int) uintptr { return uintptr(unsafe.Pointer(ptrs[i])) }
	for _, step := range []struct {
		what string
		hr   func() uintptr
	}{
		{"SetPath", func() uintptr { return s.link.call(slSetPath, up(0)) }},
		{"SetWorkingDirectory", func() uintptr { return s.link.call(slSetWorkingDir, up(1)) }},
		{"SetIconLocation", func() uintptr { return s.link.call(slSetIconLocation, up(0), 0) }},
		{"SetDescription", func() uintptr { return s.link.call(slSetDescription, up(2)) }},
		{"IPersistFile.Save", func() uintptr { return s.file.call(pfSave, up(3), 1) }},
	} {
		if err := hresult(step.what, step.hr()); err != nil {
			return err
		}
	}
	return nil
}
