package divert

import (
	"encoding/binary"
	"net/netip"
)

// Helpers for in-place inspection and rewriting of IPv4/TCP packets captured at
// the NETWORK layer. All functions assume a well-formed IPv4 packet and are
// bounds-checked defensively (returning zero values on malformed input).

// IsIPv4 reports whether buf begins with an IPv4 header.
func IsIPv4(buf []byte) bool {
	return len(buf) >= 20 && buf[0]>>4 == 4
}

// ipHeaderLen returns the IPv4 header length in bytes.
func ipHeaderLen(buf []byte) int {
	return int(buf[0]&0x0f) * 4
}

// Protocol returns the IPv4 protocol byte (6 = TCP, 17 = UDP).
func Protocol(buf []byte) byte {
	if len(buf) < 10 {
		return 0
	}
	return buf[9]
}

// SrcIP / DstIP read the IPv4 addresses.
func SrcIP(buf []byte) netip.Addr {
	if len(buf) < 16 {
		return netip.Addr{}
	}
	return netip.AddrFrom4([4]byte{buf[12], buf[13], buf[14], buf[15]})
}

func DstIP(buf []byte) netip.Addr {
	if len(buf) < 20 {
		return netip.Addr{}
	}
	return netip.AddrFrom4([4]byte{buf[16], buf[17], buf[18], buf[19]})
}

// SetSrcIP / SetDstIP overwrite the IPv4 addresses in place.
func SetSrcIP(buf []byte, ip netip.Addr) {
	if len(buf) < 16 || !ip.Is4() {
		return
	}
	a := ip.As4()
	copy(buf[12:16], a[:])
}

func SetDstIP(buf []byte, ip netip.Addr) {
	if len(buf) < 20 || !ip.Is4() {
		return
	}
	a := ip.As4()
	copy(buf[16:20], a[:])
}

// tcpOffset returns the byte offset of the TCP header.
func tcpOffset(buf []byte) int {
	return ipHeaderLen(buf)
}

// SrcPort / DstPort read the TCP ports.
func SrcPort(buf []byte) uint16 {
	o := tcpOffset(buf)
	if len(buf) < o+2 {
		return 0
	}
	return binary.BigEndian.Uint16(buf[o : o+2])
}

func DstPort(buf []byte) uint16 {
	o := tcpOffset(buf)
	if len(buf) < o+4 {
		return 0
	}
	return binary.BigEndian.Uint16(buf[o+2 : o+4])
}

// SetSrcPort / SetDstPort overwrite the TCP ports in place.
func SetSrcPort(buf []byte, port uint16) {
	o := tcpOffset(buf)
	if len(buf) < o+2 {
		return
	}
	binary.BigEndian.PutUint16(buf[o:o+2], port)
}

func SetDstPort(buf []byte, port uint16) {
	o := tcpOffset(buf)
	if len(buf) < o+4 {
		return
	}
	binary.BigEndian.PutUint16(buf[o+2:o+4], port)
}

// TCP flag bit helpers (from the 14th byte of the TCP header).
const (
	tcpFlagFIN = 0x01
	tcpFlagSYN = 0x02
	tcpFlagRST = 0x04
	tcpFlagACK = 0x10
)

func tcpFlags(buf []byte) byte {
	o := tcpOffset(buf)
	if len(buf) < o+14 {
		return 0
	}
	return buf[o+13]
}

// IsSYN reports a pure SYN (connection open) with no ACK.
func IsSYN(buf []byte) bool {
	f := tcpFlags(buf)
	return f&tcpFlagSYN != 0 && f&tcpFlagACK == 0
}

// IsFINorRST reports a connection-closing packet.
func IsFINorRST(buf []byte) bool {
	f := tcpFlags(buf)
	return f&(tcpFlagFIN|tcpFlagRST) != 0
}
