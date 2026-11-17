package capture

import (
	"encoding/binary"
	"testing"
)

// ownerTableBytes builds an owner table the way iphlpapi lays it out.
func ownerTableBytes(l ownerLayout, rows [][2]uint32) []byte {
	buf := make([]byte, 4+len(rows)*l.row)
	binary.LittleEndian.PutUint32(buf, uint32(len(rows)))
	for i, r := range rows {
		off := 4 + i*l.row
		binary.BigEndian.PutUint16(buf[off+l.port:], uint16(r[0]))
		binary.LittleEndian.PutUint32(buf[off+l.pid:], r[1])
	}
	return buf
}

// A dual-stack socket is listed in the IPv6 tables only; its owner must be
// found there (the old scan read AF_INET alone and let such sockets pass).
func TestScanOwnersAllLayouts(t *testing.T) {
	for name, l := range map[string]ownerLayout{"tcp4": tcp4Owners, "tcp6": tcp6Owners, "udp4": udp4Owners, "udp6": udp6Owners} {
		buf := ownerTableBytes(l, [][2]uint32{{443, 11}, {50123, 4242}, {65535, 7}})
		got := map[uint16]uint32{}
		scanOwners(buf, l, func(port uint16, pid uint32) bool {
			got[port] = pid
			return true
		})
		if len(got) != 3 || got[50123] != 4242 || got[443] != 11 || got[65535] != 7 {
			t.Fatalf("%s: rows = %v", name, got)
		}
		seen := 0
		scanOwners(buf[:len(buf)-1], l, func(uint16, uint32) bool { seen++; return true })
		if seen != 2 {
			t.Fatalf("%s: a truncated table must stop at the last whole row, saw %d", name, seen)
		}
		seen = 0
		scanOwners(buf, l, func(uint16, uint32) bool { seen++; return false })
		if seen != 1 {
			t.Fatalf("%s: visit=false must stop the scan", name)
		}
	}
	scanOwners(nil, udp6Owners, func(uint16, uint32) bool { t.Fatal("empty buffer has no rows"); return false })
}
