package service

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// PortClient is one client (source IP) seen on a proxy port.
type PortClient struct {
	IP        string `json:"ip"`
	Conns     int    `json:"conns"` // live connections now
	Total     int    `json:"total"` // connections since the port opened
	Upload    int64  `json:"upload"`
	Download  int64  `json:"download"`
	FirstSeen string `json:"firstSeen"`
	LastSeen  string `json:"lastSeen"`
}

// PortAccess is one access-log entry: a new connection through the port.
type PortAccess struct {
	Time     string `json:"time"`
	Client   string `json:"client"`
	Host     string `json:"host"`
	Network  string `json:"network"`
	Outbound string `json:"outbound"` // 直连 / 拦截 / 节点名
	Rule     string `json:"rule"`
}

const portAccessMax = 1000

// portMonitor aggregates a port's /connections snapshots into per-client
// stats and an access log. Closed connections keep counting toward totals.
type portMonitor struct {
	mu      sync.Mutex
	clients map[string]*PortClient
	seen    map[string]connBytes // conn id -> last bytes (live set of the previous poll)
	closedU map[string]int64     // bytes of connections that closed, per client
	closedD map[string]int64
	access  []PortAccess
	live    []ConnInfo
}

type connBytes struct {
	client   string
	up, down int64
}

func (m *portMonitor) reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clients, m.seen, m.closedU, m.closedD = nil, nil, nil, nil
	m.access, m.live = nil, nil
}

// update folds one connection snapshot in.
func (m *portMonitor) update(conns []ConnInfo, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.clients == nil {
		m.clients = map[string]*PortClient{}
		m.seen = map[string]connBytes{}
		m.closedU = map[string]int64{}
		m.closedD = map[string]int64{}
	}
	ts := now.Format("2006-01-02 15:04:05")
	next := make(map[string]connBytes, len(conns))
	liveU, liveD, liveN := map[string]int64{}, map[string]int64{}, map[string]int{}
	for _, c := range conns {
		ip := c.Source
		if ip == "" {
			ip = "未知"
		}
		cl := m.clients[ip]
		if cl == nil {
			cl = &PortClient{IP: ip, FirstSeen: ts}
			m.clients[ip] = cl
		}
		cl.LastSeen = ts
		if _, ok := m.seen[c.ID]; !ok {
			cl.Total++
			m.access = append(m.access, PortAccess{Time: ts, Client: ip, Host: c.Host, Network: c.Network, Outbound: c.Outbound, Rule: c.Rule})
		}
		next[c.ID] = connBytes{ip, c.Upload, c.Download}
		liveU[ip] += c.Upload
		liveD[ip] += c.Download
		liveN[ip]++
	}
	for id, b := range m.seen {
		if _, ok := next[id]; !ok {
			m.closedU[b.client] += b.up
			m.closedD[b.client] += b.down
		}
	}
	for ip, cl := range m.clients {
		cl.Conns = liveN[ip]
		cl.Upload = m.closedU[ip] + liveU[ip]
		cl.Download = m.closedD[ip] + liveD[ip]
	}
	if n := len(m.access); n > portAccessMax {
		m.access = append([]PortAccess(nil), m.access[n-portAccessMax:]...)
	}
	m.seen = next
	m.live = conns
}

// summary returns live connection count, byte totals and clients (most
// recently active first).
func (m *portMonitor) summary() (int, int64, int64, []PortClient) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]PortClient, 0, len(m.clients))
	var up, down int64
	for _, c := range m.clients {
		out = append(out, *c)
		up += c.Upload
		down += c.Download
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastSeen != out[j].LastSeen {
			return out[i].LastSeen > out[j].LastSeen
		}
		return out[i].IP < out[j].IP
	})
	return len(m.live), up, down, out
}

// PortDetail is the connection / log view of one port, optionally narrowed to
// one client IP.
type PortDetail struct {
	Conns  []ConnInfo   `json:"conns"`
	Access []PortAccess `json:"access"` // newest first
	Logs   []string     `json:"logs"`   // core log lines, newest last
}

var ipInLog = regexp.MustCompile(`\d{1,3}(?:\.\d{1,3}){3}`)

// ProxyPortDetail returns live connections, the access log and the core log of
// a port; client != "" keeps only that client's entries.
func (s *Service) ProxyPortDetail(id, client string) PortDetail {
	d := PortDetail{Conns: []ConnInfo{}, Access: []PortAccess{}, Logs: []string{}}
	s.ports.mu.Lock()
	rt := s.ports.rt[id]
	s.ports.mu.Unlock()
	if rt == nil {
		return d
	}
	rt.mon.mu.Lock()
	for _, c := range rt.mon.live {
		if client == "" || c.Source == client {
			d.Conns = append(d.Conns, c)
		}
	}
	for i := len(rt.mon.access) - 1; i >= 0; i-- {
		if a := rt.mon.access[i]; client == "" || a.Client == client {
			d.Access = append(d.Access, a)
		}
	}
	rt.mon.mu.Unlock()
	lines := rt.logs.since(0)
	if n := len(lines); n > 500 {
		lines = lines[n-500:]
	}
	for _, l := range lines {
		l = ansiRe.ReplaceAllString(l, "")
		if client != "" && strings.Contains(l, "inbound connection from") {
			if ip := ipInLog.FindString(l); ip != client {
				continue
			}
		}
		d.Logs = append(d.Logs, l)
	}
	return d
}

// portMonitorLoop polls every running port's clash API every 2 seconds.
func (s *Service) portMonitorLoop() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for now := range t.C {
		s.ports.mu.Lock()
		rts := make([]*portRuntime, 0, len(s.ports.rt))
		for _, rt := range s.ports.rt {
			rts = append(rts, rt)
		}
		s.ports.mu.Unlock()
		s.mu.Lock()
		labels := s.outboundLabelsLocked()
		s.mu.Unlock()
		for _, rt := range rts {
			running, port, secret, nodeName, _ := rt.state()
			if !running {
				continue
			}
			labels["proxy"] = nodeName
			conns, err := clashConnections(port, secret)
			if err != nil {
				continue
			}
			for i := range conns {
				conns[i].Outbound = labelOutbound(conns[i].OutTag, labels)
			}
			rt.mon.update(conns, now)
		}
	}
}
