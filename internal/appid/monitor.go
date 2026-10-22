package appid

import (
	"regexp"
	"strings"
	"sync"
	"time"
)

// The monitor joins two sources, because neither is enough alone:
//   - the core's info log names every connection (id, source port, target,
//     owning process, chosen outbound) and its errors, so nothing is missed —
//     but it never reports bytes, and a proxied connection that fails at the
//     far end logs no error;
//   - the clash /connections snapshot has bytes, but short connections open and
//     close between two polls and never show up.
// They are joined on source port + destination. Verdicts: data received = 成功;
// a logged error = 失败 (with the reason); open ≥ noReplyAfter with nothing
// received = 失败（无响应）; anything else that ends quietly = 完成 (not a failure).

// Conn is one live connection from the core's connection table.
type Conn struct {
	ID       string
	Process  string // exe basename
	SrcPort  string
	Dest     string // ip:port
	Host     string
	Network  string
	Rule     string
	Outbound string // friendly exit label (直连 / 拦截 / 节点名)
	Blocked  bool
	Upload   int64
	Download int64
}

// Connection outcome as shown to the user.
const (
	StatusLive    = "进行中"
	StatusOK      = "成功"
	StatusDone    = "完成"
	StatusFailed  = "失败"
	StatusBlocked = "拦截"
)

// Health of one application, derived from its recent outcomes.
const (
	HealthIdle = "idle" // no traffic seen yet
	HealthOK   = "ok"   // recent connections got data back
	HealthWarn = "warn" // a noticeable share of recent connections failed
	HealthFail = "fail" // recent connections all failed
)

// Access is one access-log entry of an application.
type Access struct {
	Time     string  `json:"time"`
	Host     string  `json:"host"`
	Network  string  `json:"network"`
	Outbound string  `json:"outbound"`
	Rule     string  `json:"rule"`
	Status   string  `json:"status"`
	Reason   string  `json:"reason,omitempty"` // why it failed
	Process  string  `json:"process"`          // exe that made it
	Path     string  `json:"path,omitempty"`   // full exe path when known
	Seconds  float64 `json:"seconds"`          // how long it lasted (so far)
	Upload   int64   `json:"upload"`
	Download int64   `json:"download"`
}

// Stat is the monitoring summary of one process.
type Stat struct {
	Process  string `json:"process"`
	Health   string `json:"health"`
	Live     int    `json:"live"`
	Total    int    `json:"total"`
	OK       int    `json:"ok"`   // got data back
	Done     int    `json:"done"` // ended quietly before bytes could be observed
	Failed   int    `json:"failed"`
	Upload   int64  `json:"upload"`
	Download int64  `json:"download"`
	LastSeen string `json:"lastSeen,omitempty"`
	LastOK   string `json:"lastOk,omitempty"`
	LastFail string `json:"lastFail,omitempty"`
	LastHost string `json:"lastHost,omitempty"`
	LastExit string `json:"lastExit,omitempty"`
}

const (
	accessMax    = 1000 // access-log entries kept per process
	recentMax    = 20   // outcomes used for Health
	processMax   = 500  // processes tracked at most (oldest idle dropped)
	noReplyAfter = 3 * time.Second
	logOnlyTTL   = 10 * time.Second // a log-only connection unseen this long has ended
	pendingTTL   = 30 * time.Second // log lines without a process line are dropped
)

type proc struct {
	stat    Stat
	closedU int64
	closedD int64
	access  []*Access
	recent  []bool // true = ok, newest last
	path    string // last full exe path seen
}

// conn tracks one connection until it gets a verdict and disappears.
type conn struct {
	key     string // process key ("" until the process is known)
	src     string // source port
	dest    string // ip:port
	udp     bool   // "inbound packet connection"
	start   time.Time
	seen    time.Time // last time it was present in a snapshot (zero = never)
	entry   *Access
	judged  bool // verdict already counted
	counted bool // added to proc.closed* on end
}

// Monitor folds core log lines and periodic connection snapshots into
// per-process statistics.
type Monitor struct {
	mu      sync.Mutex
	procs   map[string]*proc
	byLog   map[string]*conn // core log connection id
	bySock  map[string]*conn // srcPort|dest
	byClash map[string]*conn // clash connection id
	label   func(tag string) string
}

// Key normalizes a process name or path to the map key.
func Key(process string) string {
	if i := strings.LastIndexAny(process, `/\`); i >= 0 {
		process = process[i+1:]
	}
	return strings.ToLower(strings.TrimSpace(process))
}

// SetLabeler sets how raw outbound tags from the log become user labels.
func (m *Monitor) SetLabeler(fn func(tag string) string) {
	m.mu.Lock()
	m.label = fn
	m.mu.Unlock()
}

func (m *Monitor) init() {
	if m.procs == nil {
		m.procs = map[string]*proc{}
		m.byLog = map[string]*conn{}
		m.bySock = map[string]*conn{}
		m.byClash = map[string]*conn{}
	}
}

var (
	logLineRe  = regexp.MustCompile(`^\S+ \S+ \S+ (\w+) \[(\d+) [^\]]*\] (.*)$`)
	logFromRe  = regexp.MustCompile(`^inbound/[^:]+: inbound (?:packet )?connection from \S+:(\d+)$`)
	logToRe    = regexp.MustCompile(`^inbound/[^:]+: inbound (?:packet )?connection to (\S+)$`)
	logProcRe  = regexp.MustCompile(`^router: found process path: (.+)$`)
	logOutRe   = regexp.MustCompile(`^outbound/[^\[]+\[(.+?)\]: outbound (?:packet )?connection to (\S+)$`)
	ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*m`)
)

// OnLog folds one core log line in.
func (m *Monitor) OnLog(line string, now time.Time) {
	g := logLineRe.FindStringSubmatch(ansiEscape.ReplaceAllString(strings.TrimSpace(line), ""))
	if g == nil {
		return
	}
	level, id, msg := g[1], g[2], g[3]
	isErr := level == "ERROR" || level == "WARN"
	if !isErr && !strings.HasPrefix(msg, "inbound/") && !strings.HasPrefix(msg, "router: found process") &&
		!strings.HasPrefix(msg, "outbound/") {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	c := m.byLog[id]
	if s := logFromRe.FindStringSubmatch(msg); s != nil {
		if c == nil {
			c = &conn{start: now}
			m.byLog[id] = c
		}
		c.src = s[1]
		m.indexSock(c)
		return
	}
	if c == nil {
		return // DNS lookups etc. log a process without an inbound connection
	}
	if s := logToRe.FindStringSubmatch(msg); s != nil {
		c.dest = s[1]
		c.udp = strings.Contains(msg, " packet ")
		m.indexSock(c)
		return
	}
	if s := logProcRe.FindStringSubmatch(msg); s != nil {
		if c.key == "" && c.dest != "" {
			m.attach(c, s[1], now)
		}
		return
	}
	switch s := logOutRe.FindStringSubmatch(msg); {
	case s != nil:
		if c.entry != nil {
			if m.label != nil {
				c.entry.Outbound = m.label(s[1])
			} else {
				c.entry.Outbound = s[1]
			}
			if p := m.procs[c.key]; p != nil {
				p.stat.LastExit = c.entry.Outbound
			}
		}
	case isErr:
		if c.entry != nil && !c.judged && isFailure(msg) {
			m.judge(c, false, cleanReason(msg), now)
		}
	}
}

func (m *Monitor) indexSock(c *conn) {
	if c.src != "" && c.dest != "" {
		m.bySock[c.src+"|"+c.dest] = c
	}
}

// attach binds a connection to its process and opens its access-log entry.
func (m *Monitor) attach(c *conn, process string, now time.Time) {
	c.key = Key(process)
	if c.key == "" {
		return
	}
	ts := now.Format("2006-01-02 15:04:05")
	p := m.procOf(c.key, baseOf(process))
	if strings.ContainsAny(process, `/\`) {
		p.path = process
	}
	p.stat.Total++
	p.stat.LastSeen = ts
	c.entry = &Access{Time: ts, Host: c.dest, Network: "tcp", Status: StatusLive, Process: baseOf(process), Path: p.path}
	if c.udp {
		c.entry.Network = "udp"
	}
	p.stat.LastHost = c.entry.Host
	p.access = append(p.access, c.entry)
	if n := len(p.access); n > accessMax {
		p.access = append([]*Access(nil), p.access[n-accessMax:]...)
	}
}

func baseOf(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// Update folds one snapshot of the live connection table in and settles
// connections that have ended.
func (m *Monitor) Update(conns []Conn, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	ts := now.Format("2006-01-02 15:04:05")
	present := make(map[*conn]bool, len(conns))
	for _, x := range conns {
		c := m.byClash[x.ID]
		if c == nil {
			if x.Process == "" {
				continue
			}
			c = m.bySock[x.SrcPort+"|"+x.Dest]
			if c == nil {
				c = m.unjoined(x.SrcPort, Key(x.Process))
			}
			if c == nil { // log level above info: build it from the snapshot alone
				c = &conn{src: x.SrcPort, dest: x.Dest, start: now}
			}
			if x.ID != "" {
				m.byClash[x.ID] = c
			}
		}
		if c.entry == nil {
			if x.Process == "" {
				continue
			}
			m.attach(c, x.Process, now)
			if c.entry == nil {
				continue
			}
		}
		present[c] = true
		c.seen = now
		e := c.entry
		if x.Host != "" {
			e.Host = x.Host
		}
		e.Network, e.Rule, e.Upload, e.Download = x.Network, x.Rule, x.Upload, x.Download
		e.Seconds = roundSec(now.Sub(c.start))
		if x.Outbound != "" {
			e.Outbound = x.Outbound
		}
		p := m.procs[c.key]
		p.stat.LastSeen = ts
		p.stat.LastHost, p.stat.LastExit = e.Host, e.Outbound
		if !c.judged && x.Blocked {
			c.judged, e.Status = true, StatusBlocked
		}
		if !c.judged && x.Download > 0 {
			m.judge(c, true, "", now)
		}
	}
	m.settle(present, now)
	m.refresh(present)
}

// unjoined finds a log-built connection of the same process and source port
// that no snapshot has claimed yet (the destination can differ after sniffing
// or DNS rewriting).
func (m *Monitor) unjoined(src, key string) *conn {
	if src == "" {
		return nil
	}
	for _, c := range m.byLog {
		if c.src == src && c.key == key && c.seen.IsZero() {
			return c
		}
	}
	return nil
}

// settle closes out connections that are gone (seen before, absent now) or
// that only ever appeared in the log and have aged out.
func (m *Monitor) settle(present map[*conn]bool, now time.Time) {
	done := map[*conn]bool{}
	for _, idx := range []map[string]*conn{m.byLog, m.bySock, m.byClash} {
		for k, c := range idx {
			if present[c] {
				continue
			}
			ended := !c.seen.IsZero() || now.Sub(c.start) > logOnlyTTL
			if c.entry == nil && now.Sub(c.start) > pendingTTL {
				delete(idx, k)
				continue
			}
			if !ended || c.entry == nil {
				continue
			}
			if !done[c] {
				done[c] = true
				m.finish(c, now)
			}
			delete(idx, k)
		}
	}
}

func (m *Monitor) finish(c *conn, now time.Time) {
	p := m.procs[c.key]
	if p == nil || c.counted {
		return
	}
	c.counted = true
	p.closedU += c.entry.Upload
	p.closedD += c.entry.Download
	if c.judged {
		return
	}
	if c.entry.Outbound == "" && c.seen.IsZero() {
		// Process matched but no outbound was ever opened: a reject rule.
		c.judged, c.entry.Status, c.entry.Outbound = true, StatusBlocked, "拦截"
		if c.udp && strings.HasSuffix(c.dest, ":443") {
			c.entry.Reason = "QUIC（UDP 443）按设计拦截，应用会自动改用 TCP，不影响使用"
		}
		return
	}
	last := c.seen
	if last.IsZero() {
		last = c.start
	}
	if c.entry.Download == 0 && !c.seen.IsZero() && last.Sub(c.start) >= noReplyAfter {
		m.judge(c, false, "连接保持了几秒但没有收到任何数据（节点或目标无响应）", now)
		return
	}
	c.judged, c.entry.Status = true, StatusDone
	p.stat.Done++
}

func (m *Monitor) judge(c *conn, ok bool, reason string, now time.Time) {
	p := m.procs[c.key]
	if p == nil {
		return
	}
	c.judged = true
	ts := now.Format("2006-01-02 15:04:05")
	if ok {
		c.entry.Status = StatusOK
		p.stat.OK++
		p.stat.LastOK = ts
	} else {
		c.entry.Status, c.entry.Reason = StatusFailed, reason
		p.stat.Failed++
		p.stat.LastFail = ts
	}
	p.recent = append(p.recent, ok)
	if n := len(p.recent); n > recentMax {
		p.recent = p.recent[n-recentMax:]
	}
}

func (m *Monitor) refresh(present map[*conn]bool) {
	liveU, liveD, liveN := map[string]int64{}, map[string]int64{}, map[string]int{}
	for c := range present {
		liveU[c.key] += c.entry.Upload
		liveD[c.key] += c.entry.Download
		liveN[c.key]++
	}
	for key, p := range m.procs {
		p.stat.Live = liveN[key]
		p.stat.Upload = p.closedU + liveU[key]
		p.stat.Download = p.closedD + liveD[key]
		p.stat.Health = p.health()
	}
}

func (m *Monitor) procOf(key, name string) *proc {
	if p := m.procs[key]; p != nil {
		return p
	}
	if len(m.procs) >= processMax {
		m.dropOldest()
	}
	p := &proc{stat: Stat{Process: name, Health: HealthIdle}}
	m.procs[key] = p
	return p
}

func (m *Monitor) dropOldest() {
	oldest, at := "", ""
	for k, p := range m.procs {
		if p.stat.Live == 0 && (oldest == "" || p.stat.LastSeen < at) {
			oldest, at = k, p.stat.LastSeen
		}
	}
	if oldest != "" {
		delete(m.procs, oldest)
	}
}

func roundSec(d time.Duration) float64 {
	return float64(d.Milliseconds()/100) / 10
}
