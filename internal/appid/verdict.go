package appid

import "strings"

// Verdict helpers: which core errors count as failures, how a reason is shown,
// and how recent outcomes turn into an app's health.

// failureHints mark core errors meaning the connection never worked; teardown
// noise ("use of closed network connection", "upload closed") is not a failure.
var failureHints = []string{"dial ", "timeout", "timed out", "refused", "handshake", "no route",
	"unreachable", "lookup ", "no such host", "open connection", "open outbound"}

func isFailure(msg string) bool {
	l := strings.ToLower(msg)
	if strings.Contains(l, "closed") && !strings.Contains(l, "open connection") {
		return false
	}
	for _, h := range failureHints {
		if strings.Contains(l, h) {
			return true
		}
	}
	return false
}

func cleanReason(msg string) string {
	if i := strings.LastIndex(msg, ": "); i >= 0 && len(msg)-i > 6 {
		// keep the tail ("dial tcp …: i/o timeout"), the head is the component path
		if j := strings.Index(msg, ": "); j >= 0 && j < i {
			msg = msg[j+2:]
		}
	}
	if len(msg) > 200 {
		msg = msg[:200] + "…"
	}
	return msg
}

func (p *proc) health() string {
	if len(p.recent) == 0 {
		if p.stat.Done > 0 {
			return HealthOK
		}
		return HealthIdle
	}
	fails := 0
	for _, ok := range p.recent {
		if !ok {
			fails++
		}
	}
	switch {
	case fails == 0:
		return HealthOK
	case fails == len(p.recent) && fails >= 3 && p.stat.OK == 0:
		return HealthFail
	case fails*10 >= len(p.recent)*3: // ≥ 30% failed
		return HealthWarn
	}
	return HealthOK
}
