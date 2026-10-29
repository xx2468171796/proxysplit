package service

import (
	"strings"
	"time"

	"proxysplit/internal/appid"
)

// 逐应用监测：内核日志（每条连接的进程 / 出口 / 错误）+ 每秒读主内核 clash /connections（流量）合并进 appid.Monitor，
// 界面据此显示每个应用规则的连接是否成功、流量和访问日志。

// AppDetail is the monitoring view of one app rule.
type AppDetail struct {
	Stat      appid.Stat       `json:"stat"`
	Processes []appid.ProcStat `json:"processes"` // programs of the app that made traffic
	Hosts     []appid.HostStat `json:"hosts"`     // per destination, problems first
	Access    []appid.Access   `json:"access"`    // newest first
	Logs      []string         `json:"logs"`      // core warnings/errors mentioning this app's failed hosts
}

func (s *Service) appMonitorLoop() {
	s.appMon.SetLabeler(func(tag string) string {
		s.mu.Lock()
		defer s.mu.Unlock()
		return labelOutbound(tag, s.outboundLabelsLocked())
	})
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		var now time.Time
		select {
		case <-s.quit:
			return
		case now = <-t.C:
		}
		if !s.core.Running() {
			continue
		}
		s.mu.Lock()
		port, secret := s.clashPort, s.clashSecret
		labels := s.outboundLabelsLocked()
		s.mu.Unlock()
		conns, err := clashConnections(port, secret)
		if err != nil {
			// A failed poll is not "every connection closed": skip the tick, or
			// live connections would be settled now and counted again next time.
			continue
		}
		s.attributeConns(conns)
		in := make([]appid.Conn, 0, len(conns))
		for _, c := range conns {
			in = append(in, appid.Conn{
				ID: c.ID, Process: c.Process, SrcPort: c.SrcPort, Dest: c.Dest, Host: c.Host, Network: c.Network, Rule: c.Rule,
				Outbound: labelOutbound(c.OutTag, labels), Blocked: c.OutTag == "block" || c.OutTag == "reject",
				Upload: c.Upload, Download: c.Download,
			})
		}
		s.appMon.Update(in, now)
	}
}

// AppStats returns the monitoring summary of the given process names.
func (s *Service) AppStats(names []string) []appid.Stat {
	q := make([]string, len(names))
	for i, n := range names {
		q[i] = monitorName(n)
	}
	out := s.appMon.Stats(q)
	for i := range out {
		out[i].Process = names[i] // echo the caller's key
	}
	return out
}

// monitorName turns a rule match into a monitor query: a folder stays a folder
// (whole-folder app), anything else becomes its exe name.
func monitorName(match string) string {
	if IsDirRule(match) {
		return appid.NormDir(match)
	}
	return baseName(strings.TrimSpace(match))
}

// AppMonitorDetail returns stats, processes, destinations, access log and
// related core log lines of one app rule (exe name or folder).
func (s *Service) AppMonitorDetail(match string) AppDetail {
	process := monitorName(match)
	access := s.appMon.AccessLog(process)
	d := AppDetail{Stat: s.appMon.Stats([]string{process})[0], Processes: s.appMon.Processes(process),
		Hosts: appid.Hosts(access), Access: access, Logs: []string{}}
	d.Stat.Process = match
	hosts := s.appMon.FailedHosts(process)
	if len(hosts) == 0 {
		return d
	}
	for _, l := range s.logs.since(0) {
		l = ansiRe.ReplaceAllString(l, "")
		if !strings.Contains(l, "ERROR") && !strings.Contains(l, "WARN") {
			continue
		}
		for _, h := range hosts {
			if strings.Contains(l, h) {
				d.Logs = append(d.Logs, l)
				break
			}
		}
	}
	if n := len(d.Logs); n > 200 {
		d.Logs = d.Logs[n-200:]
	}
	return d
}

// ResetAppMonitor clears one process's statistics.
func (s *Service) ResetAppMonitor(match string) { s.appMon.Reset(monitorName(match)) }

// AppCatalog returns the built-in applications — with the install folders found
// on this PC — followed by the user's own.
func (s *Service) AppCatalog() []appid.App {
	s.mu.Lock()
	custom := append([]appid.App(nil), s.cfg.CustomApps...)
	s.mu.Unlock()
	var running []string
	if procs, err := s.ListProcesses(); err == nil {
		for _, p := range procs {
			if p.Path != "" {
				running = append(running, p.Path)
			}
		}
	}
	return append(appid.Discover(appid.Builtin(), appid.DiscoverEnv(running)), custom...)
}

// SetCustomApps validates and saves the user-defined applications.
func (s *Service) SetCustomApps(apps []appid.App) string {
	kept, err := appid.NormalizeCustom(apps)
	if err != nil {
		return err.Error()
	}
	s.mu.Lock()
	s.cfg.CustomApps = kept
	s.save()
	s.mu.Unlock()
	return ""
}

// IsDirRule reports whether an app rule's match is an install folder (ends with
// a path separator) rather than one program: every program under it matches.
func IsDirRule(match string) bool {
	m := strings.TrimSpace(match)
	// macOS: a whole .app bundle (Chrome's traffic comes from helpers inside it)
	return len(m) > 3 && (strings.HasSuffix(m, `\`) || strings.HasSuffix(m, "/") || strings.HasSuffix(m, ".app"))
}

// folderRule returns the normalized folder of an existing whole-folder app rule
// equal to dir.
func (s *Service) folderRule(dir string) (string, bool) {
	want, err := appid.CheckDir(dir)
	if err != nil {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.cfg.Rules {
		if IsDirRule(r.Match) && strings.EqualFold(appid.NormDir(r.Match), want) {
			return want, true
		}
	}
	return "", false
}
