package divert

import (
	"encoding/binary"
	"net/netip"
	"testing"
)

// verify recomputes the one's-complement sums; a valid packet folds to 0.
func verify(t *testing.T, b []byte) {
	t.Helper()
	h := ihl(b)
	if fold(checksum(0, b[:h])) != 0 {
		t.Fatalf("bad IPv4 header checksum")
	}
	seg := b[h:int(binary.BigEndian.Uint16(b[2:4]))]
	sum := checksum(0, b[12:20]) + uint32(b[9]) + uint32(len(seg))
	if fold(checksum(sum, seg)) != 0 {
		t.Fatalf("bad L4 checksum (proto %d)", b[9])
	}
}

// A SYN (10.0.0.2:40000 -> 93.184.216.34:80) with zeroed checksums, as an
// offloading NIC hands it to WinDivert: FixChecksums must make it valid.
func TestFixChecksumsMatchesWire(t *testing.T) {
	pkt := []byte{
		0x45, 0x00, 0x00, 0x28, 0x1c, 0x46, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 10, 0, 0, 2, 93, 184, 216, 34,
		0x9c, 0x40, 0x00, 0x50, 0, 0, 0, 1, 0, 0, 0, 0, 0x50, 0x02, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
	}
	if !FixChecksums(pkt) {
		t.Fatal("FixChecksums refused a valid packet")
	}
	verify(t, pkt)
	if !IsSYN(pkt) || IsFINorRST(pkt) || SrcPort(pkt) != 40000 || DstPort(pkt) != 80 {
		t.Fatal("header accessors wrong")
	}
	if SrcIP(pkt) != netip.MustParseAddr("10.0.0.2") || DstIP(pkt) != netip.MustParseAddr("93.184.216.34") {
		t.Fatal("address accessors wrong")
	}
}

func TestBuildUDPv4(t *testing.T) {
	src := netip.MustParseAddrPort("8.8.8.8:53")
	dst := netip.MustParseAddrPort("192.168.1.5:51000")
	for _, payload := range [][]byte{{}, {1}, []byte("odd-length payload!")} {
		b := BuildUDPv4(src, dst, payload)
		verify(t, b)
		if Protocol(b) != ProtoUDP || SrcPort(b) != 53 || DstPort(b) != 51000 || string(UDPPayload(b)) != string(payload) {
			t.Fatalf("bad datagram for payload %q", payload)
		}
	}
}

func TestMalformedPacketsAreSafe(t *testing.T) {
	for _, b := range [][]byte{nil, {0x45}, make([]byte, 19), {0x46, 0, 0, 20}} {
		if FixChecksums(b) || IsSYN(b) || SrcPort(b) != 0 || UDPPayload(b) != nil {
			t.Fatalf("malformed %v accepted", b)
		}
	}
	v6 := make([]byte, 60)
	v6[0], v6[6] = 0x60, ProtoTCP
	if !IsIPv6(v6) || Protocol(v6) != ProtoTCP || FixChecksums(v6) {
		t.Fatal("IPv6 detection wrong")
	}
}

func TestBuildRSTv6(t *testing.T) {
	syn := make([]byte, 60)
	syn[0], syn[6] = 0x60, ProtoTCP
	src, dst := netip.MustParseAddr("2408::1").As16(), netip.MustParseAddr("240e::42").As16()
	copy(syn[8:24], src[:])
	copy(syn[24:40], dst[:])
	binary.BigEndian.PutUint16(syn[40:], 50000)
	binary.BigEndian.PutUint16(syn[42:], 443)
	binary.BigEndian.PutUint32(syn[44:], 1000)
	syn[53] = tcpSYN
	r := BuildRSTv6(syn)
	if r == nil || !IsIPv6(r) || SrcPort(r) != 443 || DstPort(r) != 50000 || r[53] != tcpRST|tcpACK {
		t.Fatalf("rst = %x", r)
	}
	if binary.BigEndian.Uint32(r[48:]) != 1001 || [16]byte(r[8:24]) != dst || [16]byte(r[24:40]) != src {
		t.Fatalf("ack / addresses wrong: %x", r)
	}
	// checksum over pseudo header + segment must fold to zero
	sum := checksum(0, r[8:40]) + 20 + ProtoTCP
	if fold(checksum(sum, r[40:])) != 0 {
		t.Fatal("bad checksum")
	}
	syn[53] = tcpSYN | tcpACK
	if BuildRSTv6(syn) != nil {
		t.Fatal("SYN-ACK must not be answered")
	}
}
