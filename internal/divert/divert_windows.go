// Package divert is a minimal, cgo-free binding to WinDivert 2.2. It loads
// WinDivert.dll at runtime (which installs/loads WinDivert64.sys from the same
// folder) and exposes only the calls the process-capture engine needs. The
// driver unloads by itself once the last handle is closed — including when the
// owning process dies, so a crash never leaves packets diverted.
package divert

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Layer identifies the WinDivert capture layer.
type Layer uint32

const (
	LayerNetwork Layer = 0
	LayerSocket  Layer = 3
)

// Open flags.
const (
	FlagSniff    = 0x0001
	FlagDrop     = 0x0002
	FlagRecvOnly = 0x0004
	FlagSendOnly = 0x0008
)

// Socket-layer events (WINDIVERT_EVENT_SOCKET_*).
const (
	EventSocketBind    = 3
	EventSocketConnect = 4
	EventSocketClose   = 7
)

// Shutdown modes.
const (
	ShutdownRecv = 1
	ShutdownBoth = 3
)

const invalidHandle = ^uintptr(0)

// ErrNoData is returned by Recv after ShutdownRecv once the queue is drained.
var ErrNoData = errors.New("windivert: no more data")

// Address mirrors WINDIVERT_ADDRESS (80 bytes); bitfields via accessors.
type Address struct {
	Timestamp int64
	flags     uint32 // Layer:8 Event:8 Sniffed:1 Outbound:1 Loopback:1 Impostor:1 IPv6:1 IPChk:1 TCPChk:1 UDPChk:1
	reserved  uint32
	Union     [64]byte
}

func (a *Address) Event() uint8       { return uint8(a.flags >> 8) }
func (a *Address) Outbound() bool     { return a.flags&(1<<17) != 0 }
func (a *Address) Loopback() bool     { return a.flags&(1<<18) != 0 }
func (a *Address) IPv6() bool         { return a.flags&(1<<20) != 0 }
func (a *Address) SetOutbound(v bool) { a.setBit(17, v) }
func (a *Address) SetLoopback(v bool) { a.setBit(18, v) }

// SetChecksumsValid marks IP/TCP/UDP checksums as already computed (we compute
// them in Go), so the stack does not offload-recompute them.
func (a *Address) SetChecksumsValid() {
	a.setBit(21, true)
	a.setBit(22, true)
	a.setBit(23, true)
}

func (a *Address) setBit(pos uint, v bool) {
	if v {
		a.flags |= 1 << pos
	} else {
		a.flags &^= 1 << pos
	}
}

// IfIdx returns (IfIdx, SubIfIdx) from the NETWORK-layer union.
func (a *Address) IfIdx() (uint32, uint32) {
	return binary.LittleEndian.Uint32(a.Union[0:4]), binary.LittleEndian.Uint32(a.Union[4:8])
}

// SetIfIdx writes (IfIdx, SubIfIdx) into the NETWORK-layer union.
func (a *Address) SetIfIdx(ifIdx, subIfIdx uint32) {
	binary.LittleEndian.PutUint32(a.Union[0:4], ifIdx)
	binary.LittleEndian.PutUint32(a.Union[4:8], subIfIdx)
}

// SocketInfo is the SOCKET-layer union (WINDIVERT_DATA_SOCKET).
type SocketInfo struct {
	ProcessID uint32
	LocalPort uint16
	Protocol  uint8 // 6 TCP, 17 UDP
}

// Socket decodes the SOCKET-layer union: EndpointId u64, ParentEndpointId u64,
// ProcessId u32, LocalAddr u32[4], RemoteAddr u32[4], LocalPort u16,
// RemotePort u16, Protocol u8.
func (a *Address) Socket() SocketInfo {
	u := a.Union[:]
	return SocketInfo{
		ProcessID: binary.LittleEndian.Uint32(u[16:20]),
		LocalPort: binary.LittleEndian.Uint16(u[52:54]),
		Protocol:  u[56],
	}
}

var (
	loadMu       sync.Mutex
	dll          *windows.DLL
	procOpen     *windows.Proc
	procRecv     *windows.Proc
	procSend     *windows.Proc
	procShutdown *windows.Proc
	procClose    *windows.Proc
)

// Load loads WinDivert.dll from an absolute path (WinDivert64.sys must sit next
// to it). Safe to call repeatedly.
func Load(dllPath string) error {
	loadMu.Lock()
	defer loadMu.Unlock()
	if dll != nil {
		return nil
	}
	d, err := windows.LoadDLL(dllPath)
	if err != nil {
		return fmt.Errorf("load %s: %w", dllPath, err)
	}
	procs := map[string]**windows.Proc{
		"WinDivertOpen": &procOpen, "WinDivertRecv": &procRecv, "WinDivertSend": &procSend,
		"WinDivertShutdown": &procShutdown, "WinDivertClose": &procClose,
	}
	for name, dst := range procs {
		p, err := d.FindProc(name)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", name, err)
		}
		*dst = p
	}
	dll = d
	return nil
}

// Handle is an open WinDivert handle.
type Handle struct{ h uintptr }

// Open creates a handle for filter at layer.
func Open(filter string, layer Layer, priority int16, flags uint64) (*Handle, error) {
	if procOpen == nil {
		return nil, fmt.Errorf("windivert not loaded")
	}
	f, err := windows.BytePtrFromString(filter)
	if err != nil {
		return nil, err
	}
	r, _, e := procOpen.Call(uintptr(unsafe.Pointer(f)), uintptr(layer), uintptr(int64(priority)), uintptr(flags))
	if r == invalidHandle {
		return nil, fmt.Errorf("WinDivertOpen(%s): %w", filter, e)
	}
	return &Handle{h: r}, nil
}

// Recv blocks for the next packet/event. buf may be nil for the SOCKET layer.
func (h *Handle) Recv(buf []byte, addr *Address) (int, error) {
	var n uint32
	var p uintptr
	if len(buf) > 0 {
		p = uintptr(unsafe.Pointer(&buf[0]))
	}
	r, _, e := procRecv.Call(h.h, p, uintptr(len(buf)), uintptr(unsafe.Pointer(&n)), uintptr(unsafe.Pointer(addr)))
	if r == 0 {
		if errors.Is(e, windows.ERROR_NO_DATA) {
			return 0, ErrNoData
		}
		return 0, fmt.Errorf("WinDivertRecv: %w", e)
	}
	return int(n), nil
}

// Send injects a packet.
func (h *Handle) Send(buf []byte, addr *Address) error {
	if len(buf) == 0 {
		return nil
	}
	var n uint32
	r, _, e := procSend.Call(h.h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), uintptr(unsafe.Pointer(&n)), uintptr(unsafe.Pointer(addr)))
	if r == 0 {
		return fmt.Errorf("WinDivertSend: %w", e)
	}
	return nil
}

// Shutdown stops receiving (ShutdownRecv lets queued packets drain first).
func (h *Handle) Shutdown(how uint32) {
	if h != nil && h.h != 0 {
		_, _, _ = procShutdown.Call(h.h, uintptr(how))
	}
}

// Close closes the handle.
func (h *Handle) Close() error {
	if h == nil || h.h == 0 || h.h == invalidHandle {
		return nil
	}
	r, _, e := procClose.Call(h.h)
	h.h = 0
	if r == 0 {
		return fmt.Errorf("WinDivertClose: %w", e)
	}
	return nil
}
