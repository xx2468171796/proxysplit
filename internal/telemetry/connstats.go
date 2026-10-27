package telemetry

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// connStats folds the core's per-connection log lines into one
// net.conn_summary event per window (业主 2026-10-28: finding "IPv6 retried
// forever" or "TCP to the node times out" took reading thousands of lines).
// It counts outbound connection attempts per outbound tag and failed opens by
// outbound, error kind and destination; only the counts leave the machine.
type connStats struct {
	mu       sync.Mutex
	since    time.Time
	attempts map[string]int // outbound tag → connections opened
	fails    map[string]int // outbound tag → failed opens
	kinds    map[string]int // error kind → failed opens
	dests    map[connKey]int
	seen     map[string]struct{} // connection ids already counted this window
	v6Fails  int
}

type connKey struct{ dest, outbound, kind string }

// connSummaryEvery is the window; a window without traffic emits nothing.
const connSummaryEvery = 5 * time.Minute

// connTopN destinations are reported per window.
const connTopN = 10

var (
	// "[1234 1ms] outbound/vless[proxy]: outbound connection to host:443" —
	// the core logs it again once connected, so a connection id counts once.
	reConnStart = regexp.MustCompile(`\[(\d+) [\d.]+m?s\] outbound/[\w-]+\[([^\]]+)\]: outbound (?:packet )?connection to `)
	// "connection: open connection to DEST using outbound/vless[proxy]: ERR"
	reConnFail = regexp.MustCompile(`open (?:packet )?connection to (\S+) using outbound/[\w-]+\[([^\]]+)\]: (.*)$`)
	// sing-box colours its console output (ids, levels): strip before matching.
	reANSI = regexp.MustCompile(`\x1b\[[0-9;]*m`)
)

func newConnStats() *connStats {
	return &connStats{since: time.Now(), attempts: map[string]int{}, fails: map[string]int{}, kinds: map[string]int{}, dests: map[connKey]int{}, seen: map[string]struct{}{}}
}

// observe counts one (sanitised) log line.
func (c *connStats) observe(line string) {
	if !strings.Contains(line, "outbound") {
		return
	}
	if strings.Contains(line, "\x1b[") {
		line = reANSI.ReplaceAllString(line, "")
	}
	if m := reConnFail.FindStringSubmatch(line); m != nil {
		dest, tag, kind := m[1], m[2], connErrKind(m[3])
		c.mu.Lock()
		c.fails[tag]++
		c.kinds[kind]++
		if strings.HasPrefix(dest, "[") {
			c.v6Fails++
		}
		if len(c.dests) < 500 || c.dests[connKey{dest, tag, kind}] > 0 {
			c.dests[connKey{dest, tag, kind}]++
		}
		c.mu.Unlock()
		return
	}
	if m := reConnStart.FindStringSubmatch(line); m != nil {
		c.mu.Lock()
		if _, dup := c.seen[m[1]]; !dup && len(c.seen) < 100000 {
			c.seen[m[1]] = struct{}{}
			c.attempts[m[2]]++
		}
		c.mu.Unlock()
	}
}

// connErrKind buckets a dial error into a few stable names.
func connErrKind(err string) string {
	e := strings.ToLower(err)
	switch {
	case strings.Contains(e, "timeout") || strings.Contains(e, "deadline"):
		return "timeout"
	case strings.Contains(e, "refused"):
		return "refused"
	case strings.Contains(e, "reset"):
		return "reset"
	case strings.Contains(e, "no such host") || strings.Contains(e, "nxdomain") || strings.Contains(e, "lookup "):
		return "dns"
	case strings.Contains(e, "unreachable") || strings.Contains(e, "no route"):
		return "unreachable"
	case strings.Contains(e, "tls") || strings.Contains(e, "certificate") || strings.Contains(e, "handshake"):
		return "tls"
	case strings.Contains(e, "eof") || strings.Contains(e, "closed"):
		return "closed"
	case strings.Contains(e, "reject") || strings.Contains(e, "blocked"):
		return "rejected"
	}
	return "other"
}

// take returns the window's summary payload and resets the counters; nil
// when nothing was opened or failed. fail = at least 10 failures and over a
// third of the attempts.
func (c *connStats) take() (map[string]any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	attempts, fails := 0, 0
	for _, n := range c.attempts {
		attempts += n
	}
	for _, n := range c.fails {
		fails += n
	}
	if attempts == 0 && fails == 0 {
		c.since = time.Now()
		return nil, false
	}
	type row struct {
		k connKey
		n int
	}
	rows := make([]row, 0, len(c.dests))
	for k, n := range c.dests {
		rows = append(rows, row{k, n})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].n != rows[j].n {
			return rows[i].n > rows[j].n
		}
		return rows[i].k.dest < rows[j].k.dest
	})
	top := []map[string]any{}
	for i, r := range rows {
		if i == connTopN {
			break
		}
		top = append(top, map[string]any{"dest": r.k.dest, "outbound": r.k.outbound, "kind": r.k.kind, "n": r.n})
	}
	p := map[string]any{
		"windowSec": int(time.Since(c.since).Seconds()),
		"attempts":  c.attempts, "failures": c.fails, "kinds": c.kinds,
		"total": attempts, "failed": fails, "v6Failures": c.v6Fails, "top": top,
	}
	bad := fails >= 10 && fails*3 > attempts
	c.since, c.attempts, c.fails, c.kinds, c.dests, c.v6Fails = time.Now(), map[string]int{}, map[string]int{}, map[string]int{}, map[connKey]int{}, 0
	c.seen = map[string]struct{}{}
	return p, bad
}
