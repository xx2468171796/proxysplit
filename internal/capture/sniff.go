package capture

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"net"
	"net/http"
	"strings"
	"time"
)

// Apps that resolve through the Windows DNS client (curl, Git, games …) get
// their answer from svchost, which we don't capture, so on a mainland network
// a blocked name comes back as a poisoned IP. sing-box 1.14 has no "override
// destination with the sniffed domain" any more, so the relay does it: peek
// the first client bytes, and when they carry a TLS SNI or an HTTP Host, ask
// the group inbound for the DOMAIN (the node resolves it) instead of the IP.

const (
	sniffWait = 300 * time.Millisecond // server-speaks-first protocols fall back to the IP
	sniffMax  = 8 << 10
)

// peekHost reads the client's first bytes (bounded in time and size) and
// returns them together with the hostname they name, "" when none.
func peekHost(c net.Conn) ([]byte, string) {
	_ = c.SetReadDeadline(time.Now().Add(sniffWait))
	defer c.SetReadDeadline(time.Time{})
	buf := make([]byte, sniffMax)
	n := 0
	for n < len(buf) {
		m, err := c.Read(buf[n:])
		n += m
		if host, done := hostFrom(buf[:n]); done {
			return buf[:n], host
		}
		if err != nil {
			break
		}
	}
	return buf[:n], ""
}

// hostFrom extracts the SNI / Host from b; done reports that more bytes would
// not change the answer (a complete record / header, or not TLS / HTTP at all).
func hostFrom(b []byte) (host string, done bool) {
	if len(b) == 0 {
		return "", false
	}
	if b[0] == 0x16 { // TLS handshake record
		if len(b) < 5 {
			return "", false
		}
		end := 5 + int(binary.BigEndian.Uint16(b[3:5]))
		if len(b) < end {
			return "", false
		}
		return validHost(tlsSNI(b[5:end])), true
	}
	if !looksHTTP(b) {
		return "", true
	}
	if !bytes.Contains(b, []byte("\r\n\r\n")) {
		return "", false
	}
	req, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(b)))
	if err != nil {
		return "", true
	}
	h := req.Host
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	return validHost(h), true
}

func looksHTTP(b []byte) bool {
	for _, m := range []string{"GET ", "POST ", "HEAD ", "PUT ", "DELETE ", "OPTIONS ", "PATCH ", "CONNECT "} {
		if len(b) >= len(m) && string(b[:len(m)]) == m || len(b) < len(m) && strings.HasPrefix(m, string(b)) {
			return true
		}
	}
	return false
}

// tlsSNI parses a ClientHello handshake message and returns its server_name.
func tlsSNI(h []byte) string {
	if len(h) < 4 || h[0] != 0x01 {
		return ""
	}
	p := h[4:]
	skip := func(n int) bool {
		if len(p) < n {
			return false
		}
		p = p[n:]
		return true
	}
	vec := func(lenBytes int) bool {
		if len(p) < lenBytes {
			return false
		}
		n := 0
		for i := 0; i < lenBytes; i++ {
			n = n<<8 | int(p[i])
		}
		return skip(lenBytes + n)
	}
	if !skip(2+32) || !vec(1) || !vec(2) || !vec(1) || len(p) < 2 { // version, random, session, suites, compression
		return ""
	}
	ext := p[2:]
	for len(ext) >= 4 {
		typ, n := binary.BigEndian.Uint16(ext[0:2]), int(binary.BigEndian.Uint16(ext[2:4]))
		if len(ext) < 4+n {
			return ""
		}
		if typ == 0 { // server_name
			d := ext[4 : 4+n]
			if len(d) >= 5 && d[2] == 0 {
				l := int(binary.BigEndian.Uint16(d[3:5]))
				if len(d) >= 5+l {
					return string(d[5 : 5+l])
				}
			}
			return ""
		}
		ext = ext[4+n:]
	}
	return ""
}

// validHost keeps real DNS names only (no IP literals, no junk).
func validHost(h string) string {
	h = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(h)), ".")
	if h == "" || len(h) > 253 || net.ParseIP(h) != nil || !strings.Contains(h, ".") {
		return ""
	}
	for _, r := range h {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '.' || r == '_') {
			return ""
		}
	}
	return h
}
