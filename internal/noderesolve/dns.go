package noderesolve

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// Server is one upstream resolver.
type Server struct {
	Name string // shown in logs / telemetry, e.g. "alidns", "system:192.168.1.1"
	Kind string // KindUDP | KindDoH
	Addr string // ip:port (udp) or https URL (doh)
}

const (
	KindUDP = "udp"
	KindDoH = "doh"
)

// errNoAnswer: the server replied, but without a usable address.
var errNoAnswer = errors.New("no address in answer")

// errNXDomain: the server says the name does not exist.
var errNXDomain = errors.New("nxdomain")

// buildQuery returns a recursive query for host / qtype in wire format.
func buildQuery(host string, qtype dnsmessage.Type) ([]byte, uint16, error) {
	name, err := dnsmessage.NewName(strings.TrimSuffix(host, ".") + ".")
	if err != nil {
		return nil, 0, err
	}
	var idb [2]byte
	_, _ = rand.Read(idb[:])
	id := binary.BigEndian.Uint16(idb[:])
	msg := dnsmessage.Message{
		Header:    dnsmessage.Header{ID: id, RecursionDesired: true},
		Questions: []dnsmessage.Question{{Name: name, Type: qtype, Class: dnsmessage.ClassINET}},
	}
	b, err := msg.Pack()
	return b, id, err
}

// parseAnswers extracts A / AAAA records from a response. id 0 skips the
// check (DoH requires ID 0 on the wire).
func parseAnswers(b []byte, id uint16) ([]netip.Addr, error) {
	var p dnsmessage.Parser
	h, err := p.Start(b)
	if err != nil {
		return nil, err
	}
	if h.ID != id {
		return nil, fmt.Errorf("dns id mismatch")
	}
	switch h.RCode {
	case dnsmessage.RCodeSuccess:
	case dnsmessage.RCodeNameError:
		return nil, errNXDomain
	default:
		return nil, fmt.Errorf("rcode %s", h.RCode)
	}
	if err := p.SkipAllQuestions(); err != nil {
		return nil, err
	}
	var out []netip.Addr
	for {
		ah, err := p.AnswerHeader()
		if errors.Is(err, dnsmessage.ErrSectionDone) {
			break
		}
		if err != nil {
			return nil, err
		}
		switch ah.Type {
		case dnsmessage.TypeA:
			r, err := p.AResource()
			if err != nil {
				return nil, err
			}
			out = append(out, netip.AddrFrom4(r.A))
		case dnsmessage.TypeAAAA:
			r, err := p.AAAAResource()
			if err != nil {
				return nil, err
			}
			out = append(out, netip.AddrFrom16(r.AAAA))
		default:
			if err := p.SkipAnswer(); err != nil {
				return nil, err
			}
		}
	}
	if len(out) == 0 {
		return nil, errNoAnswer
	}
	return out, nil
}

// exchangeUDP sends one query over UDP and reads the matching reply.
func exchangeUDP(ctx context.Context, d *net.Dialer, addr string, q []byte, id uint16) ([]netip.Addr, error) {
	c, err := d.DialContext(ctx, "udp", addr)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	stop := context.AfterFunc(ctx, func() { _ = c.SetDeadline(time.Unix(1, 0)) })
	defer stop()
	if dl, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(dl)
	}
	if _, err := c.Write(q); err != nil {
		return nil, err
	}
	buf := make([]byte, 1500)
	for {
		n, err := c.Read(buf)
		if err != nil {
			if cerr := ctx.Err(); cerr != nil {
				return nil, cerr
			}
			return nil, err
		}
		ips, perr := parseAnswers(buf[:n], id)
		if perr != nil && perr.Error() == "dns id mismatch" {
			continue // stray / spoofed reply: keep waiting
		}
		return ips, perr
	}
}

// exchangeDoH posts one query (RFC 8484 wire format, ID 0).
func exchangeDoH(ctx context.Context, client *http.Client, url string, q []byte) ([]netip.Addr, error) {
	q = append([]byte(nil), q...)
	q[0], q[1] = 0, 0
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(q))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("doh http %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return nil, err
	}
	return parseAnswers(b, 0)
}

// errorCode normalises a resolver error for telemetry.
func errorCode(err error) string {
	if err == nil {
		return ""
	}
	var ne net.Error
	switch {
	case errors.Is(err, context.Canceled):
		return "late"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &ne) && ne.Timeout():
		return "timeout"
	case errors.Is(err, errNXDomain):
		return "nxdomain"
	case errors.Is(err, errNoAnswer):
		return "empty"
	case errors.Is(err, errBogusOnly):
		return "bogus"
	case strings.Contains(err.Error(), "refused"):
		return "refused"
	case strings.Contains(err.Error(), "doh http"), strings.Contains(err.Error(), "tls"), strings.Contains(err.Error(), "x509"):
		return "doh"
	}
	return "error"
}
