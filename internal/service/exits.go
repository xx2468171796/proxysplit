package service

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/core"
)

// Live exit IPs for the AI page (业主 2026-10-28): what the world sees on each
// path, refreshed every few seconds while the page is open.
//   - direct: this PC's own network (ProxySplit itself is never tunnelled);
//   - proxy:  through the primary line's loopback inbound (the selected node);
//   - ai:     through the AI-line proxy (core AIProxy), on claude.ai's own
//     trace — exactly the exit Claude sees. That proxy never connects
//     directly (no line = refused), so this probe cannot reach AI from the
//     customer's own IP.
//
// Cloudflare traces are free and unmetered; the IP details (city, ASN, type)
// come from iplocate.io, which has a small free quota, so they are cached per
// address.
// Trace URLs are variables for tests.
var (
	exitTraceURL   = "https://www.cloudflare.com/cdn-cgi/trace"
	exitAITraceURL = "https://claude.ai/cdn-cgi/trace"
)

const (
	exitsFresh   = 2500 * time.Millisecond // callers polling every 3 s share one probe
	exitTimeout  = 5 * time.Second
	ipInfoOK     = 30 * time.Minute
	ipInfoFailed = 2 * time.Minute
)

// ExitInfo is one path's exit.
type ExitInfo struct {
	Path      string `json:"path"`  // direct | proxy | ai
	State     string `json:"state"` // ok | off (path not available) | fail
	Via       string `json:"via,omitempty"`
	IP        string `json:"ip,omitempty"`
	Country   string `json:"country,omitempty"`
	City      string `json:"city,omitempty"`
	Kind      string `json:"kind,omitempty"` // 住宅宽带 IP / 机房 IP …
	ASN       string `json:"asn,omitempty"`
	Ours      bool   `json:"ours"` // a POWER云 exit
	LatencyMs int    `json:"latencyMs,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

// ExitsReport is the three paths at one moment.
type ExitsReport struct {
	Direct    ExitInfo `json:"direct"`
	Proxy     ExitInfo `json:"proxy"`
	AI        ExitInfo `json:"ai"`
	Running   bool     `json:"running"`
	CheckedAt string   `json:"checkedAt"`
}

type exitsCache struct {
	mu     sync.Mutex // one probe at a time; later callers get its result
	at     time.Time
	report ExitsReport
	infoMu sync.Mutex
	info   map[string]cachedIPInfo
}

type cachedIPInfo struct {
	info ipInfo
	ok   bool
	at   time.Time
}

// exitProbeLocked returns the loopback probe into the selected node (core
// ExitProbe), credentials fixed for this run; a fresh start moves the port if
// it got taken. nil when no port is free. Caller holds s.mu.
func (s *Service) exitProbeLocked() *core.AIProxy {
	p := &s.exitProbe
	if p.User == "" {
		p.User, p.Pass, p.Outbound = "probe", randomHex(12), "proxy"
	}
	if p.Port == 0 || (!s.coreRunning() && !loopbackTCPFree(p.Port)) {
		p.Port, _ = core.FreePort()
	}
	if p.Port == 0 {
		return nil
	}
	cp := *p
	return &cp
}

// proxyProbeURL is how Exits reaches the selected node: the ExitProbe inbound
// when it listens (TUN mode), else the primary line's inbound.
func (s *Service) proxyProbeURL() string {
	s.mu.Lock()
	p := s.exitProbe
	s.mu.Unlock()
	if p.Port > 0 && !loopbackTCPFree(p.Port) {
		return fmt.Sprintf("http://%s:%s@127.0.0.1:%d", p.User, p.Pass, p.Port)
	}
	if port := s.core.Port(); port > 0 {
		return "http://127.0.0.1:" + strconv.Itoa(port)
	}
	return ""
}

// Exits probes the three exits (cached for exitsFresh).
func (s *Service) Exits(ctx context.Context) ExitsReport {
	c := &s.exits
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.at) < exitsFresh {
		return c.report
	}
	running := s.core.Running()
	proxyURL := ""
	if running {
		proxyURL = s.proxyProbeURL()
	}
	ai := s.AIProxy()
	s.mu.Lock()
	proxyVia := ""
	if n := s.activeNodeLocked(""); n != nil {
		proxyVia = n.Name
	}
	official := s.aiGuardOut != "" && s.aiGuardOut != "reject" && s.aiNodeLocked("") != nil
	s.mu.Unlock()

	rep := ExitsReport{Running: running}
	var wg sync.WaitGroup
	probe := func(dst *ExitInfo, path, via, proxy, trace string) {
		*dst = ExitInfo{Path: path, Via: via}
		wg.Add(1)
		go func() { defer wg.Done(); s.probeExit(ctx, dst, proxy, trace) }()
	}
	probe(&rep.Direct, "direct", "本机网络", "", exitTraceURL)
	switch {
	case proxyURL == "":
		rep.Proxy = ExitInfo{Path: "proxy", State: "off", Detail: "代理没在运行"}
	default:
		probe(&rep.Proxy, "proxy", proxyVia, proxyURL, exitTraceURL)
	}
	switch {
	case !ai.Running || ai.HTTPURL == "":
		rep.AI = ExitInfo{Path: "ai", State: "off", Detail: "代理没在运行：AI 不会走本机网络（劫持开着时 AI 打不开）"}
	case !ai.Available:
		rep.AI = ExitInfo{Path: "ai", State: "off", Detail: "没有可用线路：AI 被拦截，不会走本机网络"}
	default:
		probe(&rep.AI, "ai", ai.Node, ai.HTTPURL, exitAITraceURL)
	}
	wg.Wait()
	if rep.AI.State == "ok" && official {
		rep.AI.Ours = true
	}
	rep.CheckedAt = time.Now().Format(time.RFC3339)
	c.report, c.at = rep, time.Now()
	return rep
}

// probeExit fills dst from one trace through proxy ("" = direct).
func (s *Service) probeExit(ctx context.Context, dst *ExitInfo, proxy, trace string) {
	tr := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	if proxy != "" {
		u, err := url.Parse(proxy)
		if err != nil {
			dst.State, dst.Detail = "fail", "本机代理地址无效"
			return
		}
		tr.Proxy = http.ProxyURL(u)
	}
	c, cancel := context.WithTimeout(ctx, exitTimeout)
	defer cancel()
	r := traceWith(c, &http.Client{Timeout: exitTimeout, Transport: tr}, trace)
	if r.err != nil {
		dst.State, dst.Detail = "fail", "检测不通："+shortErr(r.err)
		return
	}
	dst.State, dst.IP, dst.Country = "ok", r.ip, r.loc
	dst.LatencyMs = int(r.latency.Milliseconds())
	dst.Ours = aiguard.IsOurExit(r.ip)
	if info, ok := s.exitIPInfo(ctx, r.ip); ok {
		dst.City, dst.Kind = info.City, info.kind()
		dst.ASN = strings.TrimSpace(info.ASN.ASN + " " + info.ASN.Name)
	}
}

// exitIPInfo looks ip up once per ipInfoOK (failures retried after ipInfoFailed).
func (s *Service) exitIPInfo(ctx context.Context, ip string) (ipInfo, bool) {
	c := &s.exits
	c.infoMu.Lock()
	if c.info == nil {
		c.info = map[string]cachedIPInfo{}
	}
	hit, found := c.info[ip]
	c.infoMu.Unlock()
	ttl := ipInfoFailed
	if hit.ok {
		ttl = ipInfoOK
	}
	if found && time.Since(hit.at) < ttl {
		return hit.info, hit.ok
	}
	info, err := lookupIP(ctx, ip)
	hit = cachedIPInfo{info: info, ok: err == nil, at: time.Now()}
	c.infoMu.Lock()
	if len(c.info) > 64 { // addresses change rarely; keep the map small
		clear(c.info)
	}
	c.info[ip] = hit
	c.infoMu.Unlock()
	return hit.info, hit.ok
}

func shortErr(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "Client.Timeout") || strings.Contains(msg, "deadline exceeded") {
		return "超时"
	}
	if len(msg) > 120 {
		msg = msg[:120]
	}
	return msg
}
