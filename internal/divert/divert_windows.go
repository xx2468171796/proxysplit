// Package divert is a minimal, cgo-free binding to WinDivert 2.x. It loads
// WinDivert.dll at runtime (which in turn loads WinDivert64.sys), exposing just
// the handful of calls the redirect engine needs.
package divert

import (
	"encoding/binary"
	"fmt"
	"syscall"
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
	FlagNoInstall = 0x0010
)

// Checksum recalculation flags (0 = recompute all).
const (
	HelperNoIPChecksum  = 1
	HelperNoTCPChecksum = 4
)

const invalidHandle = ^uintptr(0)

// Address mirrors WINDIVERT_ADDRESS (80 bytes). The packed bitfields are exposed
// through accessor methods.
type Address struct {
	Timestamp int64
	flags     uint32 // Layer:8 Event:8 Sniffed:1 Outbound:1 Loopback:1 Impostor:1 IPv6:1 IPChk:1 TCPChk:1 UDPChk:1 Reserved1:8
	Reserved2 uint32
	Union     [64]byte
}

func (a *Address) Outbound() bool { return a.flags&(1<<17) != 0 }
func (a *Address) Loopback() bool { return a.flags&(1<<18) != 0 }
func (a *Address) Impostor() bool { return a.flags&(1<<19) != 0 }
func (a *Address) IPv6() bool     { return a.flags&(1<<20) != 0 }

func (a *Address) SetOutbound(v bool) { a.setBit(17, v) }
func (a *Address) SetLoopback(v bool) { a.setBit(18, v) }
func (a *Address) SetIPv6(v bool)     { a.setBit(20, v) }

func (a *Address) setBit(pos uint, v bool) {
	if v {
		a.flags |= 1 << pos
	} else {
		a.flags &^= 1 << pos
	}
}

// NetworkIfIdx returns the (IfIdx, SubIfIdx) from the NETWORK-layer data union.
func (a *Address) NetworkIfIdx() (uint32, uint32) {
	return binary.LittleEndian.Uint32(a.Union[0:4]), binary.LittleEndian.Uint32(a.Union[4:8])
}

// SetNetworkIfIdx writes the (IfIdx, SubIfIdx) into the NETWORK-layer data union.
func (a *Address) SetNetworkIfIdx(ifIdx, subIfIdx uint32) {
	binary.LittleEndian.PutUint32(a.Union[0:4], ifIdx)
	binary.LittleEndian.PutUint32(a.Union[4:8], subIfIdx)
}

var (
	dll *windows.DLL

	procOpen          *windows.Proc
	procRecv          *windows.Proc
	procSend          *windows.Proc
	procClose         *windows.Proc
	procCalcChecksums *windows.Proc
)

// Load loads WinDivert.dll from the given absolute path (the matching
// WinDivert64.sys must sit next to it). Safe to call more than once.
func Load(dllPath string) error {
	if dll != nil {
		return nil
	}
	d, err := windows.LoadDLL(dllPath)
	if err != nil {
		return fmt.Errorf("load %s: %w", dllPath, err)
	}
	dll = d
	for name, dst := range map[string]**windows.Proc{
		"WinDivertOpen":                 &procOpen,
		"WinDivertRecv":                 &procRecv,
		"WinDivertSend":                 &procSend,
		"WinDivertClose":                &procClose,
		"WinDivertHelperCalcChecksums":  &procCalcChecksums,
	} {
		p, err := d.FindProc(name)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", name, err)
		}
		*dst = p
	}
	return nil
}

// Handle is an open WinDivert capture handle.
type Handle struct {
	h uintptr
}

// Open creates a capture handle for the given filter at the given layer.
func Open(filter string, layer Layer, priority int16, flags uint64) (*Handle, error) {
	if procOpen == nil {
		return nil, fmt.Errorf("windivert not loaded")
	}
	f, err := windows.BytePtrFromString(filter)
	if err != nil {
		return nil, err
	}
	r, _, e := procOpen.Call(
		uintptr(unsafe.Pointer(f)),
		uintptr(layer),
		uintptr(priority),
		uintptr(flags),
	)
	if r == invalidHandle {
		return nil, fmt.Errorf("WinDivertOpen: %w", e)
	}
	return &Handle{h: r}, nil
}

// Recv blocks until a packet matching the filter arrives, copying it into buf
// and populating addr. It returns the number of bytes read.
func (h *Handle) Recv(buf []byte, addr *Address) (int, error) {
	var recvLen uint32
	r, _, e := procRecv.Call(
		h.h,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&recvLen)),
		uintptr(unsafe.Pointer(addr)),
	)
	if r == 0 {
		return 0, fmt.Errorf("WinDivertRecv: %w", e)
	}
	return int(recvLen), nil
}

// Send injects a (possibly modified) packet back into the network stack.
func (h *Handle) Send(buf []byte, addr *Address) (int, error) {
	var sendLen uint32
	r, _, e := procSend.Call(
		h.h,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&sendLen)),
		uintptr(unsafe.Pointer(addr)),
	)
	if r == 0 {
		return 0, fmt.Errorf("WinDivertSend: %w", e)
	}
	return int(sendLen), nil
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

// CalcChecksums recomputes IP/TCP/UDP checksums for a modified packet.
func CalcChecksums(buf []byte, addr *Address, flags uint64) error {
	r, _, e := procCalcChecksums.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(addr)),
		uintptr(flags),
	)
	if r == 0 {
		return fmt.Errorf("WinDivertHelperCalcChecksums: %w", e)
	}
	return nil
}

// ensure syscall import is used even if the toolchain prunes it.
var _ = syscall.Handle(0)
