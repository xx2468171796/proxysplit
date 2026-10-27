package capture

import (
	"fmt"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// owners maps local (protocol, port) -> pid, fed by the SOCKET-layer sniff
// handle (connect / bind events arrive before the first packet in practice)
// with the iphlpapi owner tables as a fallback for the race (resolveLoop, never
// on the probe loop).
type owners struct {
	mu    sync.Mutex
	ports map[uint32]uint32 // proto<<16|port -> pid
	exes  map[uint32]exeEntry
}

type exeEntry struct {
	path string
	at   time.Time
}

func newOwners() *owners {
	return &owners{ports: map[uint32]uint32{}, exes: map[uint32]exeEntry{}}
}

func ownerKey(proto uint8, port uint16) uint32 { return uint32(proto)<<16 | uint32(port) }

func (o *owners) set(proto uint8, port uint16, pid uint32) {
	o.mu.Lock()
	o.ports[ownerKey(proto, port)] = pid
	o.mu.Unlock()
}

func (o *owners) forget(proto uint8, port uint16) {
	o.mu.Lock()
	delete(o.ports, ownerKey(proto, port))
	o.mu.Unlock()
}

func (o *owners) peek(proto uint8, port uint16) (uint32, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	pid, ok := o.ports[ownerKey(proto, port)]
	return pid, ok
}

// exe returns the image path for pid (cached for a minute; pids recycle slowly).
func (o *owners) exe(pid uint32) string {
	now := time.Now()
	o.mu.Lock()
	e, ok := o.exes[pid]
	o.mu.Unlock()
	if ok && now.Sub(e.at) < time.Minute {
		return e.path
	}
	path := imagePath(pid)
	o.mu.Lock()
	if len(o.exes) > 4096 {
		o.exes = map[uint32]exeEntry{}
	}
	o.exes[pid] = exeEntry{path: path, at: now}
	o.mu.Unlock()
	return path
}

func imagePath(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if windows.QueryFullProcessImageName(h, 0, &buf[0], &size) != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

var (
	iphlpapi           = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcp = iphlpapi.NewProc("GetExtendedTcpTable")
	procGetExtendedUdp = iphlpapi.NewProc("GetExtendedUdpTable")
)

// tableOwner scans the IPv4 owner-pid table (TCP_TABLE_OWNER_PID_ALL = 5,
// UDP_TABLE_OWNER_PID = 1). Rows: TCP 6×u32 (pid last), UDP 3×u32.
func tableOwner(proto uint8, port uint16) (uint32, bool) {
	proc, class, words := procGetExtendedTcp, uintptr(5), 6
	if proto == 17 {
		proc, class, words = procGetExtendedUdp, 1, 3
	}
	buf, err := ownerTable(proc, class)
	if err != nil || len(buf) < 4 {
		return 0, false
	}
	n := int(*(*uint32)(unsafe.Pointer(&buf[0])))
	rowSize := words * 4
	localPortWord := 2
	if proto == 17 {
		localPortWord = 1
	}
	for i := 0; i < n; i++ {
		off := 4 + i*rowSize
		if off+rowSize > len(buf) {
			break
		}
		raw := *(*uint32)(unsafe.Pointer(&buf[off+localPortWord*4]))
		p := uint16(raw&0xff)<<8 | uint16(raw>>8&0xff)
		if p == port {
			return *(*uint32)(unsafe.Pointer(&buf[off+(words-1)*4])), true
		}
	}
	return 0, false
}

func ownerTable(proc *windows.LazyProc, class uintptr) ([]byte, error) {
	var size uint32
	for i := 0; i < 3; i++ {
		var p uintptr
		buf := make([]byte, size+1)
		if size > 0 {
			p = uintptr(unsafe.Pointer(&buf[0]))
		}
		r, _, _ := proc.Call(p, uintptr(unsafe.Pointer(&size)), 0, 2 /*AF_INET*/, class, 0)
		if r == 0 && p != 0 {
			return buf, nil
		}
		if r != 0 && r != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
			return nil, fmt.Errorf("owner table: %d", r)
		}
	}
	return nil, fmt.Errorf("owner table keeps growing")
}
