package capture

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"time"
)

// Minimal SOCKS5 client pieces: UDP ASSOCIATE (RFC 1928 §7) for relaying a
// captured program's datagrams into a sing-box mixed inbound. TCP uses
// golang.org/x/net/proxy.

// EncodeUDPHeader prefixes payload with the SOCKS5 UDP request header for dst.
func EncodeUDPHeader(dst netip.AddrPort, payload []byte) []byte {
	a := dst.Addr().Unmap()
	var b []byte
	if a.Is4() {
		b = make([]byte, 0, 10+len(payload))
		b = append(b, 0, 0, 0, 1)
		v := a.As4()
		b = append(b, v[:]...)
	} else {
		b = make([]byte, 0, 22+len(payload))
		b = append(b, 0, 0, 0, 4)
		v := a.As16()
		b = append(b, v[:]...)
	}
	b = binary.BigEndian.AppendUint16(b, dst.Port())
	return append(b, payload...)
}

// DecodeUDPHeader splits a SOCKS5 UDP reply into source address and payload.
// Domain-typed sources are not expected from sing-box and are rejected.
func DecodeUDPHeader(b []byte) (netip.AddrPort, []byte, error) {
	if len(b) < 4 || b[2] != 0 {
		return netip.AddrPort{}, nil, errors.New("socks udp: bad header")
	}
	var n int
	switch b[3] {
	case 1:
		n = 4
	case 4:
		n = 16
	default:
		return netip.AddrPort{}, nil, fmt.Errorf("socks udp: atyp %d", b[3])
	}
	if len(b) < 4+n+2 {
		return netip.AddrPort{}, nil, errors.New("socks udp: short")
	}
	addr, _ := netip.AddrFromSlice(b[4 : 4+n])
	port := binary.BigEndian.Uint16(b[4+n:])
	return netip.AddrPortFrom(addr.Unmap(), port), b[4+n+2:], nil
}

// udpAssociate opens a UDP association on the SOCKS5 server at server and
// returns the control connection (closing it ends the association) and the
// relay address to send datagrams to.
func udpAssociate(server string, timeout time.Duration) (net.Conn, *net.UDPAddr, error) {
	c, err := net.DialTimeout("tcp", server, timeout)
	if err != nil {
		return nil, nil, err
	}
	_ = c.SetDeadline(time.Now().Add(timeout))
	fail := func(e error) (net.Conn, *net.UDPAddr, error) { c.Close(); return nil, nil, e }
	if _, err := c.Write([]byte{5, 1, 0}); err != nil {
		return fail(err)
	}
	var greet [2]byte
	if _, err := io.ReadFull(c, greet[:]); err != nil || greet[1] != 0 {
		return fail(fmt.Errorf("socks greet: %v", err))
	}
	if _, err := c.Write([]byte{5, 3, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return fail(err)
	}
	var head [4]byte
	if _, err := io.ReadFull(c, head[:]); err != nil || head[1] != 0 {
		return fail(fmt.Errorf("socks associate refused: %v %d", err, head[1]))
	}
	alen := 4
	if head[3] == 4 {
		alen = 16
	} else if head[3] != 1 {
		return fail(fmt.Errorf("socks associate atyp %d", head[3]))
	}
	rest := make([]byte, alen+2)
	if _, err := io.ReadFull(c, rest); err != nil {
		return fail(err)
	}
	ip := net.IP(rest[:alen])
	if ip.IsUnspecified() {
		ip = net.IPv4(127, 0, 0, 1)
	}
	_ = c.SetDeadline(time.Time{})
	return c, &net.UDPAddr{IP: ip, Port: int(binary.BigEndian.Uint16(rest[alen:]))}, nil
}
