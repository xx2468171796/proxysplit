// Package proc maps TCP connections to their owning process on Windows.
package proc

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modiphlpapi             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = modiphlpapi.NewProc("GetExtendedTcpTable")
	procGetExtendedUdpTable = modiphlpapi.NewProc("GetExtendedUdpTable")
)

const (
	afInet              = 2 // AF_INET
	tcpTableOwnerPidAll = 5 // TCP_TABLE_OWNER_PID_ALL
	udpTableOwnerPid    = 1 // UDP_TABLE_OWNER_PID
)

// mibUDPRowOwnerPID mirrors the Win32 MIB_UDPROW_OWNER_PID structure.
type mibUDPRowOwnerPID struct {
	LocalAddr uint32
	LocalPort uint32 // low 16 bits, network byte order
	OwningPID uint32
}

// mibTCPRowOwnerPID mirrors the Win32 MIB_TCPROW_OWNER_PID structure.
type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32 // low 16 bits, network byte order
	RemoteAddr uint32
	RemotePort uint32
	OwningPID  uint32
}

// Lookup resolves connections to processes with a short-lived cache so that a
// burst of packet lookups does not re-query the kernel table for every packet.
type Lookup struct {
	mu         sync.Mutex
	byPort     map[uint16]uint32 // TCP localPort -> pid
	fetched    time.Time
	udpByPort  map[uint16]uint32 // UDP localPort -> pid
	udpFetched time.Time
	ttl        time.Duration
	exeCache   map[uint32]string // pid -> exe path
}

// NewLookup returns a Lookup whose TCP table snapshot is considered fresh for
// ttl (e.g. 250ms is a good balance for connection-setup lookups).
func NewLookup(ttl time.Duration) *Lookup {
	if ttl <= 0 {
		ttl = 250 * time.Millisecond
	}
	return &Lookup{
		byPort:    map[uint16]uint32{},
		udpByPort: map[uint16]uint32{},
		ttl:       ttl,
		exeCache:  map[uint32]string{},
	}
}

// PIDByLocalPort returns the PID owning the given local TCP port. It refreshes
// the snapshot when stale; if the port is missing it forces one refresh in case
// the connection was created after the last snapshot.
func (l *Lookup) PIDByLocalPort(port uint16) (uint32, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if time.Since(l.fetched) > l.ttl {
		l.refreshLocked()
	}
	if pid, ok := l.byPort[port]; ok {
		return pid, true
	}
	// New connection not yet in snapshot: force a refresh once.
	l.refreshLocked()
	pid, ok := l.byPort[port]
	return pid, ok
}

// ExePath returns the full image path for a PID, cached across calls.
func (l *Lookup) ExePath(pid uint32) (string, error) {
	l.mu.Lock()
	if p, ok := l.exeCache[pid]; ok {
		l.mu.Unlock()
		return p, nil
	}
	l.mu.Unlock()

	p, err := exePath(pid)
	if err != nil {
		return "", err
	}
	l.mu.Lock()
	l.exeCache[pid] = p
	l.mu.Unlock()
	return p, nil
}

// ExeByLocalPort is the combined helper: local port -> owning exe path.
func (l *Lookup) ExeByLocalPort(port uint16) (uint32, string, bool) {
	pid, ok := l.PIDByLocalPort(port)
	if !ok || pid == 0 {
		return 0, "", false
	}
	exe, err := l.ExePath(pid)
	if err != nil {
		return pid, "", false
	}
	return pid, exe, true
}

// PIDByLocalUDPPort returns the PID owning the given local UDP port.
func (l *Lookup) PIDByLocalUDPPort(port uint16) (uint32, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if time.Since(l.udpFetched) > l.ttl {
		l.refreshUDPLocked()
	}
	if pid, ok := l.udpByPort[port]; ok {
		return pid, true
	}
	l.refreshUDPLocked()
	pid, ok := l.udpByPort[port]
	return pid, ok
}

// ExeByLocalUDPPort resolves a local UDP port to its owning exe path.
func (l *Lookup) ExeByLocalUDPPort(port uint16) (uint32, string, bool) {
	pid, ok := l.PIDByLocalUDPPort(port)
	if !ok || pid == 0 {
		return 0, "", false
	}
	exe, err := l.ExePath(pid)
	if err != nil {
		return pid, "", false
	}
	return pid, exe, true
}

func (l *Lookup) refreshUDPLocked() {
	rows, err := udpTable()
	if err != nil {
		return
	}
	m := make(map[uint16]uint32, len(rows))
	for i := range rows {
		port := ntohs(uint16(rows[i].LocalPort & 0xffff))
		m[port] = rows[i].OwningPID
	}
	l.udpByPort = m
	l.udpFetched = time.Now()
}

// udpTable fetches the full IPv4 owner-PID UDP table.
func udpTable() ([]mibUDPRowOwnerPID, error) {
	var size uint32
	r, _, _ := procGetExtendedUdpTable.Call(
		0, uintptr(unsafe.Pointer(&size)), 0,
		uintptr(afInet), uintptr(udpTableOwnerPid), 0,
	)
	if r != 0 && r != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
		return nil, fmt.Errorf("GetExtendedUdpTable size: %d", r)
	}
	if size == 0 {
		return nil, nil
	}
	buf := make([]byte, size)
	r, _, _ = procGetExtendedUdpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0,
		uintptr(afInet), uintptr(udpTableOwnerPid), 0,
	)
	if r != 0 {
		return nil, fmt.Errorf("GetExtendedUdpTable: %d", r)
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	if n == 0 {
		return nil, nil
	}
	rowsPtr := unsafe.Pointer(&buf[4])
	rows := unsafe.Slice((*mibUDPRowOwnerPID)(rowsPtr), int(n))
	out := make([]mibUDPRowOwnerPID, n)
	copy(out, rows)
	return out, nil
}

func (l *Lookup) refreshLocked() {
	rows, err := tcpTable()
	if err != nil {
		return
	}
	m := make(map[uint16]uint32, len(rows))
	for i := range rows {
		port := ntohs(uint16(rows[i].LocalPort & 0xffff))
		m[port] = rows[i].OwningPID
	}
	l.byPort = m
	l.fetched = time.Now()
}

// tcpTable fetches the full IPv4 owner-PID TCP table.
func tcpTable() ([]mibTCPRowOwnerPID, error) {
	var size uint32
	// First call to size the buffer.
	r, _, _ := procGetExtendedTcpTable.Call(
		0, uintptr(unsafe.Pointer(&size)), 0,
		uintptr(afInet), uintptr(tcpTableOwnerPidAll), 0,
	)
	if r != 0 && r != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
		return nil, fmt.Errorf("GetExtendedTcpTable size: %d", r)
	}
	if size == 0 {
		return nil, nil
	}
	buf := make([]byte, size)
	r, _, _ = procGetExtendedTcpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0,
		uintptr(afInet), uintptr(tcpTableOwnerPidAll), 0,
	)
	if r != 0 {
		return nil, fmt.Errorf("GetExtendedTcpTable: %d", r)
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	if n == 0 {
		return nil, nil
	}
	// Rows follow the leading DWORD count.
	rowsPtr := unsafe.Pointer(&buf[4])
	rows := unsafe.Slice((*mibTCPRowOwnerPID)(rowsPtr), int(n))
	out := make([]mibTCPRowOwnerPID, n)
	copy(out, rows)
	return out, nil
}

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

func ntohs(v uint16) uint16 {
	return (v << 8) | (v >> 8)
}

// BaseName returns the lowercased final path element, e.g. "code.exe".
func BaseName(p string) string {
	p = strings.ReplaceAll(p, "/", "\\")
	if i := strings.LastIndex(p, "\\"); i >= 0 {
		p = p[i+1:]
	}
	return strings.ToLower(p)
}
