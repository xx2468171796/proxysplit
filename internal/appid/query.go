package appid

import (
	"sort"
	"strings"
)

// Queries take a process name ("chrome.exe") or, for a whole-folder app, a
// folder ending in a path separator ("C:\Program Files\ldplayer9box\"): then
// every tracked program whose exe lies under that folder is rolled up.

// IsDir reports whether name is a folder (whole-folder app) rather than one exe.
func IsDir(name string) bool {
	n := strings.TrimSpace(name)
	return len(n) > 3 && (strings.HasSuffix(n, `\`) || strings.HasSuffix(n, "/"))
}

func underDir(path, dir string) bool {
	p := strings.ToLower(strings.ReplaceAll(path, "/", `\`))
	d := strings.TrimRight(strings.ToLower(strings.ReplaceAll(strings.TrimSpace(dir), "/", `\`)), `\`) + `\`
	return p != "" && strings.HasPrefix(p, d)
}

// procsFor returns the tracked processes a name stands for. Caller holds m.mu.
func (m *Monitor) procsFor(name string) []*proc {
	if !IsDir(name) {
		if p := m.procs[Key(name)]; p != nil {
			return []*proc{p}
		}
		return nil
	}
	var out []*proc
	for _, p := range m.procs {
		if underDir(p.path, name) {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].stat.Process < out[j].stat.Process })
	return out
}

// ProcStat is one program inside an app and how much traffic it made.
type ProcStat struct {
	Process  string `json:"process"`
	Path     string `json:"path,omitempty"`
	Total    int    `json:"total"`
	Failed   int    `json:"failed"`
	Download int64  `json:"download"`
	LastSeen string `json:"lastSeen,omitempty"`
}

// Stats returns the summaries of the given names (missing ones as idle), or of
// every tracked process when names is empty.
func (m *Monitor) Stats(names []string) []Stat {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(names) == 0 {
		out := make([]Stat, 0, len(m.procs))
		for _, p := range m.procs {
			out = append(out, p.stat)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].LastSeen > out[j].LastSeen })
		return out
	}
	out := make([]Stat, 0, len(names))
	for _, n := range names {
		out = append(out, m.rollup(n, m.procsFor(n)))
	}
	return out
}

// rollup merges several processes' stats under one name. Caller holds m.mu.
func (m *Monitor) rollup(name string, ps []*proc) Stat {
	s := Stat{Process: name, Health: HealthIdle}
	var recent []bool
	for _, p := range ps {
		x := p.stat
		s.Live += x.Live
		s.Total += x.Total
		s.OK += x.OK
		s.Done += x.Done
		s.Failed += x.Failed
		s.Upload += x.Upload
		s.Download += x.Download
		if x.LastSeen > s.LastSeen {
			s.LastSeen, s.LastHost, s.LastExit = x.LastSeen, x.LastHost, x.LastExit
		}
		s.LastOK = maxStr(s.LastOK, x.LastOK)
		s.LastFail = maxStr(s.LastFail, x.LastFail)
		recent = append(recent, p.recent...)
	}
	if len(ps) > 0 {
		agg := proc{stat: s, recent: recent}
		s.Health = agg.health()
	}
	return s
}

func maxStr(a, b string) string {
	if b > a {
		return b
	}
	return a
}

// Processes lists the programs behind a name that made traffic.
func (m *Monitor) Processes(name string) []ProcStat {
	m.mu.Lock()
	defer m.mu.Unlock()
	ps := m.procsFor(name)
	out := make([]ProcStat, 0, len(ps))
	for _, p := range ps {
		out = append(out, ProcStat{Process: p.stat.Process, Path: p.path, Total: p.stat.Total,
			Failed: p.stat.Failed, Download: p.stat.Download, LastSeen: p.stat.LastSeen})
	}
	return out
}

// AccessLog returns the access log behind a name, newest first.
func (m *Monitor) AccessLog(name string) []Access {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Access
	for _, p := range m.procsFor(name) {
		for _, a := range p.access {
			out = append(out, *a)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	if out == nil {
		out = []Access{}
	}
	return out
}

// HostStat is one destination of an app: how often, how well, and via where.
type HostStat struct {
	Host      string  `json:"host"`
	Conns     int     `json:"conns"`
	Live      int     `json:"live"`
	OK        int     `json:"ok"`
	Done      int     `json:"done"`
	Failed    int     `json:"failed"`
	Blocked   int     `json:"blocked"`
	Upload    int64   `json:"upload"`
	Download  int64   `json:"download"`
	Exit      string  `json:"exit"`    // last exit used
	Network   string  `json:"network"` // tcp | udp | tcp+udp
	LastSeen  string  `json:"lastSeen"`
	LastError string  `json:"lastError"` // newest failure reason
	Seconds   float64 `json:"seconds"`   // longest connection
}

// Hosts groups an access log by destination: destinations with failures first,
// ones that were only ever blocked (QUIC, by design) last, then the busiest.
func Hosts(log []Access) []HostStat {
	by := map[string]*HostStat{}
	var order []string
	for i := len(log) - 1; i >= 0; i-- { // oldest first, so "last" fields end newest
		a := log[i]
		h := by[a.Host]
		if h == nil {
			h = &HostStat{Host: a.Host, Network: a.Network}
			by[a.Host] = h
			order = append(order, a.Host)
		}
		h.Conns++
		switch a.Status {
		case StatusLive:
			h.Live++
		case StatusOK:
			h.OK++
		case StatusDone:
			h.Done++
		case StatusFailed:
			h.Failed++
			h.LastError = a.Reason
		case StatusBlocked:
			h.Blocked++
		}
		h.Upload += a.Upload
		h.Download += a.Download
		if a.Outbound != "" {
			h.Exit = a.Outbound
		}
		if a.Network != "" && a.Network != h.Network && !strings.Contains(h.Network, a.Network) {
			h.Network += "+" + a.Network
		}
		h.LastSeen = maxStr(h.LastSeen, a.Time)
		if a.Seconds > h.Seconds {
			h.Seconds = a.Seconds
		}
	}
	out := make([]HostStat, 0, len(order))
	for _, k := range order {
		out = append(out, *by[k])
	}
	onlyBlocked := func(h HostStat) bool { return h.Blocked == h.Conns }
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Failed > 0) != (out[j].Failed > 0) {
			return out[i].Failed > 0
		}
		if onlyBlocked(out[i]) != onlyBlocked(out[j]) { // QUIC blocked by design: least interesting
			return !onlyBlocked(out[i])
		}
		if out[i].Conns != out[j].Conns {
			return out[i].Conns > out[j].Conns
		}
		return out[i].LastSeen > out[j].LastSeen
	})
	return out
}

// FailedHosts returns the distinct hosts of failed connections behind a name.
func (m *Monitor) FailedHosts(name string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := map[string]bool{}
	var out []string
	for _, p := range m.procsFor(name) {
		for _, a := range p.access {
			if a.Status == StatusFailed && a.Host != "" && !seen[a.Host] {
				seen[a.Host] = true
				out = append(out, a.Host)
			}
		}
	}
	return out
}

// Reset clears the statistics behind a name.
func (m *Monitor) Reset(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	drop := map[string]bool{}
	for k, p := range m.procs {
		if (IsDir(name) && underDir(p.path, name)) || (!IsDir(name) && k == Key(name)) {
			drop[k] = true
			delete(m.procs, k)
		}
	}
	for _, idx := range []map[string]*conn{m.byLog, m.bySock, m.byClash} {
		for k, c := range idx {
			if drop[c.key] {
				delete(idx, k)
			}
		}
	}
}
