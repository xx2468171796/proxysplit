package divert

import (
	"encoding/binary"
	"net/netip"
)

// Pure-Go helpers for IPv4 TCP/UDP packets captured at the NETWORK layer. They
// are bounds-checked (zero values on malformed input) and platform-neutral so
// the rewrite logic is unit-tested without the driver.

// Protocol numbers.
const (
	ProtoTCP = 6
	ProtoUDP = 17
)

// IsIPv4 reports a well-formed IPv4 header at the start of buf.
func IsIPv4(b []byte) bool {
	return len(b) >= 20 && b[0]>>4 == 4 && int(b[0]&0x0f)*4 >= 20 && len(b) >= int(b[0]&0x0f)*4
}

// IsIPv6 reports an IPv6 packet.
func IsIPv6(b []byte) bool { return len(b) >= 40 && b[0]>>4 == 6 }

func ihl(b []byte) int { return int(b[0]&0x0f) * 4 }

// Protocol returns the IPv4 protocol (or IPv6 next header, no extension walk).
func Protocol(b []byte) byte {
	switch {
	case IsIPv4(b):
		return b[9]
	case IsIPv6(b):
		return b[6]
	}
	return 0
}

func SrcIP(b []byte) netip.Addr {
	if !IsIPv4(b) {
		return netip.Addr{}
	}
	return netip.AddrFrom4([4]byte(b[12:16]))
}

func DstIP(b []byte) netip.Addr {
	if !IsIPv4(b) {
		return netip.Addr{}
	}
	return netip.AddrFrom4([4]byte(b[16:20]))
}

func SetSrcIP(b []byte, ip netip.Addr) {
	if IsIPv4(b) && ip.Is4() {
		a := ip.As4()
		copy(b[12:16], a[:])
	}
}

func SetDstIP(b []byte, ip netip.Addr) {
	if IsIPv4(b) && ip.Is4() {
		a := ip.As4()
		copy(b[16:20], a[:])
	}
}

// l4 returns the transport header offset, or -1 (IPv6 uses the fixed header).
func l4(b []byte) int {
	switch {
	case IsIPv4(b):
		return ihl(b)
	case IsIPv6(b):
		return 40
	}
	return -1
}

// SrcPort / DstPort read TCP or UDP ports (same offsets for both).
func SrcPort(b []byte) uint16 {
	o := l4(b)
	if o < 0 || len(b) < o+4 {
		return 0
	}
	return binary.BigEndian.Uint16(b[o:])
}

func DstPort(b []byte) uint16 {
	o := l4(b)
	if o < 0 || len(b) < o+4 {
		return 0
	}
	return binary.BigEndian.Uint16(b[o+2:])
}

func SetSrcPort(b []byte, p uint16) {
	if o := l4(b); o >= 0 && len(b) >= o+4 {
		binary.BigEndian.PutUint16(b[o:], p)
	}
}

func SetDstPort(b []byte, p uint16) {
	if o := l4(b); o >= 0 && len(b) >= o+4 {
		binary.BigEndian.PutUint16(b[o+2:], p)
	}
}

const (
	tcpFIN = 0x01
	tcpSYN = 0x02
	tcpRST = 0x04
	tcpACK = 0x10
)

func tcpFlags(b []byte) byte {
	o := l4(b)
	if o < 0 || len(b) < o+14 {
		return 0
	}
	return b[o+13]
}

// IsSYN reports a pure SYN (connection open, no ACK).
func IsSYN(b []byte) bool { f := tcpFlags(b); return f&tcpSYN != 0 && f&tcpACK == 0 }

// IsFINorRST reports a closing segment.
func IsFINorRST(b []byte) bool { return tcpFlags(b)&(tcpFIN|tcpRST) != 0 }

// UDPPayload returns the UDP payload of an IPv4 packet.
func UDPPayload(b []byte) []byte {
	if !IsIPv4(b) || b[9] != ProtoUDP || len(b) < ihl(b)+8 {
		return nil
	}
	return b[ihl(b)+8:]
}

// checksum folds the one's-complement sum of data onto sum.
func checksum(sum uint32, data []byte) uint32 {
	for len(data) >= 2 {
		sum += uint32(binary.BigEndian.Uint16(data))
		data = data[2:]
	}
	if len(data) == 1 {
		sum += uint32(data[0]) << 8
	}
	return sum
}

func fold(sum uint32) uint16 {
	for sum>>16 != 0 {
		sum = sum&0xffff + sum>>16
	}
	return ^uint16(sum)
}

// FixChecksums recomputes the IPv4 header checksum and the TCP/UDP checksum of
// an IPv4 packet in place. Returns false for packets it cannot handle.
func FixChecksums(b []byte) bool {
	if !IsIPv4(b) {
		return false
	}
	h := ihl(b)
	total := int(binary.BigEndian.Uint16(b[2:4]))
	if total < h || total > len(b) {
		return false
	}
	b = b[:total]
	b[10], b[11] = 0, 0
	binary.BigEndian.PutUint16(b[10:], fold(checksum(0, b[:h])))
	seg := b[h:]
	var off int
	switch b[9] {
	case ProtoTCP:
		off = 16
	case ProtoUDP:
		off = 6
	default:
		return true
	}
	if len(seg) < off+2 {
		return false
	}
	seg[off], seg[off+1] = 0, 0
	sum := checksum(0, b[12:20]) // src + dst
	sum += uint32(b[9]) + uint32(len(seg))
	c := fold(checksum(sum, seg))
	if b[9] == ProtoUDP && c == 0 {
		c = 0xffff
	}
	binary.BigEndian.PutUint16(seg[off:], c)
	return true
}

// BuildUDPv4 builds an IPv4/UDP datagram with valid checksums.
func BuildUDPv4(src, dst netip.AddrPort, payload []byte) []byte {
	n := 28 + len(payload)
	b := make([]byte, n)
	b[0] = 0x45
	binary.BigEndian.PutUint16(b[2:], uint16(n))
	b[8] = 64
	b[9] = ProtoUDP
	s, d := src.Addr().As4(), dst.Addr().As4()
	copy(b[12:16], s[:])
	copy(b[16:20], d[:])
	binary.BigEndian.PutUint16(b[20:], src.Port())
	binary.BigEndian.PutUint16(b[22:], dst.Port())
	binary.BigEndian.PutUint16(b[24:], uint16(8+len(payload)))
	copy(b[28:], payload)
	FixChecksums(b)
	return b
}

// BuildRSTv6 answers an IPv6 TCP SYN with RST|ACK (addresses and ports
// swapped, ack = seq+1, valid checksum), so the app sees "connection refused"
// at once and falls back to IPv4 instead of waiting out SYN retries. nil when
// syn is not a plain IPv6 TCP SYN.
func BuildRSTv6(syn []byte) []byte {
	if !IsIPv6(syn) || syn[6] != ProtoTCP || len(syn) < 60 || !IsSYN(syn) {
		return nil
	}
	b := make([]byte, 60)
	b[0] = 0x60
	binary.BigEndian.PutUint16(b[4:], 20)
	b[6] = ProtoTCP
	b[7] = 64
	copy(b[8:24], syn[24:40])
	copy(b[24:40], syn[8:24])
	t, s := b[40:], syn[40:]
	copy(t[0:2], s[2:4])
	copy(t[2:4], s[0:2])
	binary.BigEndian.PutUint32(t[8:], binary.BigEndian.Uint32(s[4:])+1)
	t[12] = 5 << 4
	t[13] = tcpRST | tcpACK
	sum := checksum(0, b[8:40]) // src + dst
	sum += 20 + ProtoTCP
	binary.BigEndian.PutUint16(t[16:], fold(checksum(sum, t)))
	return b
}
