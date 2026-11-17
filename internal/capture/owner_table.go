package capture

import "encoding/binary"

// ownerLayout describes one row of a GetExtendedTcpTable / GetExtendedUdpTable
// owner-pid table: row size and the byte offsets of the local port and pid.
type ownerLayout struct{ row, port, pid int }

// Row layouts (iphlpapi, all fields 4-byte aligned, table = u32 count + rows):
//
//	MIB_TCPROW_OWNER_PID   state, localAddr, localPort, remoteAddr, remotePort, pid
//	MIB_TCP6ROW_OWNER_PID  localAddr[16], localScope, localPort, remoteAddr[16], remoteScope, remotePort, state, pid
//	MIB_UDPROW_OWNER_PID   localAddr, localPort, pid
//	MIB_UDP6ROW_OWNER_PID  localAddr[16], localScope, localPort, pid
//
// The IPv6 tables matter for IPv4 traffic too: a dual-stack socket (the
// default for many runtimes) is listed there only.
var (
	tcp4Owners = ownerLayout{row: 24, port: 8, pid: 20}
	tcp6Owners = ownerLayout{row: 56, port: 20, pid: 52}
	udp4Owners = ownerLayout{row: 12, port: 4, pid: 8}
	udp6Owners = ownerLayout{row: 28, port: 20, pid: 24}
)

// scanOwners calls visit for every (local port, pid) row of an owner table
// until visit returns false. Truncated tables are read as far as they go.
func scanOwners(buf []byte, l ownerLayout, visit func(port uint16, pid uint32) bool) {
	if len(buf) < 4 {
		return
	}
	n := int(binary.LittleEndian.Uint32(buf))
	for i := 0; i < n; i++ {
		off := 4 + i*l.row
		if off+l.row > len(buf) {
			return
		}
		// The port is a u32 holding the 16-bit port in network byte order.
		port := binary.BigEndian.Uint16(buf[off+l.port:])
		if !visit(port, binary.LittleEndian.Uint32(buf[off+l.pid:])) {
			return
		}
	}
}
