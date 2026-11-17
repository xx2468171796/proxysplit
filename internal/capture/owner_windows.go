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

const (
	afInet  = 2
	afInet6 = 23
)

// ownerTables lists the owner-pid tables of a protocol, IPv4 then IPv6
// (TCP_TABLE_OWNER_PID_ALL = 5, UDP_TABLE_OWNER_PID = 1).
func ownerTables(proto uint8) (proc *windows.LazyProc, class uintptr, v4, v6 ownerLayout) {
	if proto == 17 {
		return procGetExtendedUdp, 1, udp4Owners, udp6Owners
	}
	return procGetExtendedTcp, 5, tcp4Owners, tcp6Owners
}

// tableOwner looks a local port up in the system owner-pid tables of both
// address families (a dual-stack socket is only in the IPv6 one).
func tableOwner(proto uint8, port uint16) (pid uint32, found bool) {
	proc, class, v4, v6 := ownerTables(proto)
	for _, t := range []struct {
		family uintptr
		layout ownerLayout
	}{{afInet, v4}, {afInet6, v6}} {
		buf, err := ownerTable(proc, class, t.family)
		if err != nil {
			continue
		}
		scanOwners(buf, t.layout, func(p uint16, owner uint32) bool {
			if p == port {
				pid, found = owner, true
			}
			return !found
		})
		if found {
			return pid, true
		}
	}
	return 0, false
}

// portOwners snapshots which processes have each local port of a protocol
// bound (both families); ok=false when a table could not be read.
func portOwners(proto uint8) (owners map[uint16][]uint32, ok bool) {
	proc, class, v4, v6 := ownerTables(proto)
	owners = map[uint16][]uint32{}
	for _, t := range []struct {
		family uintptr
		layout ownerLayout
	}{{afInet, v4}, {afInet6, v6}} {
		buf, err := ownerTable(proc, class, t.family)
		if err != nil {
			return nil, false
		}
		scanOwners(buf, t.layout, func(p uint16, owner uint32) bool {
			owners[p] = append(owners[p], owner)
			return true
		})
	}
	return owners, true
}

func ownerTable(proc *windows.LazyProc, class, family uintptr) ([]byte, error) {
	var size uint32
	for i := 0; i < 3; i++ {
		var p uintptr
		buf := make([]byte, size+1)
		if size > 0 {
			p = uintptr(unsafe.Pointer(&buf[0]))
		}
		r, _, _ := proc.Call(p, uintptr(unsafe.Pointer(&size)), 0, family, class, 0)
		if r == 0 && p != 0 {
			return buf, nil
		}
		if r != 0 && r != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
			return nil, fmt.Errorf("owner table: %d", r)
		}
	}
	return nil, fmt.Errorf("owner table keeps growing")
}
