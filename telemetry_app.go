package main

// Client telemetry wiring (internal/telemetry; docs/memory/telemetry.md):
// every binding records its operation with ONE line at the call site through
// the helpers below, so parallel branches touching app*.go rarely conflict.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/appid"
	"proxysplit/internal/core"
	"proxysplit/internal/license"
	"proxysplit/internal/noderesolve"
	"proxysplit/internal/service"
	"proxysplit/internal/telemetry"
	"proxysplit/internal/updater"
)

// initTelemetry starts the recorder (no-op in dev builds without an API URL
// or with PROXYSPLIT_TELEMETRY=off) and records the launch environment.
func (a *App) initTelemetry() {
	if a.lic == nil || a.lic.APIBase() == "" {
		return
	}
	osInfo := telemetry.OSInfo()
	err := telemetry.Init(telemetry.Config{
		DataDir: dataDir(), Endpoint: a.lic.APIBase() + "/v1/client/telemetry", Transport: telemetryTransport(),
		Token: a.lic.AccessToken,
		Meta: func() telemetry.Meta {
			m := telemetry.Meta{DeviceID: a.lic.TelemetryDeviceID(), AppVersion: appVersion, OS: osInfo, Arch: runtime.GOARCH, AccountHint: telemetry.MaskAccount(a.lic.Username())}
			if a.svc != nil {
				m.CoreVersion = a.svc.GetCoreVersion()
			}
			return m
		},
	})
	if err != nil {
		return
	}
	a.svc.SetLogTap(telemetry.Log)
	service.SetNodeResolveHook(tmNodeResolve)
	service.SetEventHook(func(typ string, err error, p map[string]any) { telemetry.Emit(typ, telemetry.Info, err, p) })
	telemetry.Note(telemetry.AppStart, map[string]any{"os": osInfo, "arch": runtime.GOARCH, "admin": telemetry.IsAdmin(), "locale": telemetry.Locale(), "freshInstall": a.freshInstall, "background": a.background, "snapshot": a.tmSnapshot()})
	go a.tmEnvProbes()
}

// tmEnvProbes records environment facts that explain "nothing works" reports.
func (a *App) tmEnvProbes() {
	defer telemetry.Recover()
	st := a.licenseStatus()
	telemetry.Note(telemetry.License, map[string]any{"enabled": st.Enabled, "signedIn": st.SignedIn, "authenticated": st.Authenticated, "plan": st.PlanCode, "tier": st.Tier, "channel": st.Channel, "expiresAt": st.ExpiresAt, "error": st.Error})
	telemetry.Note(telemetry.EnvSecurity, map[string]any{"products": service.DetectSecuritySoftware()})
	telemetry.Note(telemetry.EnvOtherVPN, map[string]any{"adapters": aiguard.OtherVPNAdapters(), "ipv6": aiguard.HasGlobalIPv6()})
	time.Sleep(30 * time.Second) // keep PowerShell off the startup path
	telemetry.Note(telemetry.EnvDefender, telemetry.DefenderDetections())
}

// tmSnapshot is the sanitised mode / settings snapshot attached to starts.
func (a *App) tmSnapshot() map[string]any {
	if a.svc == nil {
		return nil
	}
	st, s := a.svc.Status(), a.svc.GetSettings()
	// global = whole machine (TunMode); otherwise per-app split captured by the
	// WinDivert for selected programs only (default) or the sing-box TUN.
	capture := service.CaptureTUN
	if s.TunMode {
		capture = "global"
	} else if s.ProcessCapture() {
		capture = service.CaptureProcess
	}
	return map[string]any{
		"capture": capture, "ruleMode": a.svc.GetRuleMode(), "clashMode": a.svc.GetClashMode(), "routing": a.svc.GetRouting().Enabled,
		"protocol": a.tmNodeType(st.SelectedID), "appRules": len(a.svc.GetAppRules()), "customRules": len(a.svc.GetCustomRules()),
		"fakeIP": s.FakeIP, "remoteDNS": s.RemoteDNS, "blockQUIC": s.BlockQUIC, "lanShare": s.LanShare, "systemProxy": a.svc.GetSystemProxy(),
	}
}

// tmNodeType is the protocol of a node ("" if unknown); never its address.
func (a *App) tmNodeType(id string) string {
	p, _ := a.tmNodeInfo(id)
	return p
}

// tmNodeInfo is a node's protocol and effective core ("" if unknown).
func (a *App) tmNodeInfo(id string) (protocol, core string) {
	for _, n := range a.svc.Nodes() {
		if n.ID == id {
			if n.Official {
				return n.Type + "/official", n.EffectiveCore()
			}
			return n.Type, n.EffectiveCore()
		}
	}
	return "", ""
}

func (a *App) tmNode(id string) map[string]any {
	p, c := a.tmNodeInfo(id)
	return map[string]any{"protocol": p, "core": c}
}

// tmText records a binding that returns "" or a user-facing error message,
// and passes the message through.
func tmText(typ string, start time.Time, payload map[string]any, msg string) string {
	telemetry.FailText(typ, start, strings.TrimPrefix(msg, "NOTICE:"), payload)
	return msg
}

// tmErr records an error-returning operation and passes the error through.
func tmErr(typ string, start time.Time, payload map[string]any, err error) error {
	telemetry.Op(typ, start, err, payload)
	return err
}

// tmMs records a latency probe (ms, -1 = failed) and passes the value through.
func (a *App) tmMs(typ, id string, start time.Time, ms int) int {
	p := a.tmNode(id)
	p["ms"] = ms
	var err error
	if ms < 0 {
		err = telemetry.Errorf("timeout or unreachable")
	}
	telemetry.Op(typ, start, err, p)
	return ms
}

// tmSpeed records a speed test.
func (a *App) tmSpeed(id string, start time.Time, r SpeedResult) SpeedResult {
	p := a.tmNode(id)
	p["mbps"] = r.Mbps
	telemetry.FailText(telemetry.NodeSpeed, start, r.Err, p)
	return r
}

// tmStart records a proxy start; the TUN outcome comes from the core log
// (telemetry/logwatch.go).
func (a *App) tmStart(trigger string, start time.Time, err error) error {
	p := a.tmSnapshot()
	p["trigger"] = trigger
	telemetry.Op(telemetry.ProxyStart, start, err, p)
	return err
}

// tmUpdate records an update check result.
func tmUpdate(start time.Time, st updater.Status) updater.Status {
	p := map[string]any{"available": st.Available}
	if st.Release != nil {
		p["version"] = st.Release.Version
	}
	telemetry.FailText(telemetry.AppUpdateCheck, start, st.Error, p)
	return st
}

// schemesOf counts share-link schemes in pasted text (scheme only).
func schemesOf(text string) map[string]any {
	out := map[string]any{}
	for _, line := range strings.Fields(text) {
		if i := strings.Index(line, "://"); i > 0 && i < 20 {
			k := strings.ToLower(line[:i])
			n, _ := out[k].(int)
			out[k] = n + 1
		}
	}
	return out
}

// appRuleDiff lists apps added / removed between two rule lists.
func appRuleDiff(before, after []service.AppRule) map[string]any {
	key := func(r service.AppRule) string { return r.Match + "→" + r.Line }
	old, cur := map[string]bool{}, map[string]bool{}
	for _, r := range before {
		old[key(r)] = true
	}
	for _, r := range after {
		cur[key(r)] = true
	}
	return map[string]any{"added": setDiff(cur, old), "removed": setDiff(old, cur), "total": len(after)}
}

// ruleDiff lists custom domain / IP rules added / removed (targets kept).
func ruleDiff(before, after []core.RouteRule) map[string]any {
	key := func(r core.RouteRule) string { return r.Type + ":" + r.Value + "→" + r.Action }
	old, cur := map[string]bool{}, map[string]bool{}
	for _, r := range before {
		old[key(r)] = true
	}
	for _, r := range after {
		cur[key(r)] = true
	}
	return map[string]any{"added": setDiff(cur, old), "removed": setDiff(old, cur), "total": len(after)}
}

func setDiff(a, b map[string]bool) []string {
	out := []string{}
	for k := range a {
		if !b[k] && len(out) < 50 {
			out = append(out, k)
		}
	}
	return out
}

// settingsDiff lists changed settings keys as old → new (secrets dropped by
// the sanitiser's key rules: lanUser / lanPass).
func settingsDiff(before, after service.Settings) map[string]any {
	var o, n map[string]any
	ob, _ := json.Marshal(before)
	nb, _ := json.Marshal(after)
	_ = json.Unmarshal(ob, &o)
	_ = json.Unmarshal(nb, &n)
	changes := map[string]any{}
	for k, v := range n {
		if fmt.Sprint(o[k]) != fmt.Sprint(v) {
			changes[k] = map[string]any{"old": o[k], "new": v}
		}
	}
	for _, secret := range []string{"lanUser", "lanPass"} {
		if _, ok := changes[secret]; ok {
			changes[secret] = "changed"
		}
	}
	return map[string]any{"changes": changes}
}

// tmBlocked records the post-start "blocked by security software" check.
func tmBlocked(msg string) string {
	if msg != "" {
		telemetry.Emit(telemetry.NetBlocked, telemetry.Fail, telemetry.Errorf("%s", msg), map[string]any{"products": service.DetectSecuritySoftware()})
	}
	return msg
}

// tmSelfTest / tmRoute / tmAIEnv record diagnostic results.
func tmSelfTest(start time.Time, r service.SelfTestReport) service.SelfTestReport {
	var err error
	if r.Failed > 0 {
		err = telemetry.Errorf("%d case(s) failed: %s", r.Failed, r.Summary)
	}
	telemetry.Op(telemetry.SelfTest, start, err, map[string]any{"cases": len(r.Cases), "failed": r.Failed, "hints": r.Hints, "dnsLogs": r.DNSLogs})
	return r
}

func tmRoute(start time.Time, r service.RouteTestResult) service.RouteTestResult {
	p := urlHost(r.URL) // the user-typed URL may carry tokens; host only
	p["process"], p["ok"], p["httpCode"], p["route"] = r.Process, r.OK, r.HTTPCode, r.Route
	telemetry.FailText(telemetry.RouteTest, start, r.Error, p)
	return r
}

func tmAIEnv(start time.Time, r service.AIEnvReport) service.AIEnvReport {
	items, bad := make([]any, 0, len(r.Items)), 0
	for _, it := range r.Items {
		items = append(items, map[string]any{"id": it.ID, "status": it.Status, "detail": it.Detail})
		if it.Status == "fail" {
			bad++
		}
	}
	var err error
	if bad > 0 {
		err = telemetry.Errorf("%d AI environment item(s) failed", bad)
	}
	telemetry.Op(telemetry.AIEnvCheck, start, err, map[string]any{"items": items, "exitKind": r.ExitKind, "exitLoc": r.ExitLoc, "exitOurs": r.ExitOurs})
	return r
}

// TrackPage records a main-screen view (bound to the UI; fire-and-forget).
func (a *App) TrackPage(page string) {
	if len(page) <= 40 {
		telemetry.Note(telemetry.AppPageView, map[string]any{"page": page})
	}
}

// telemetryExit flushes on shutdown; pending segments go out next launch.
func telemetryExit() {
	telemetry.Note(telemetry.AppExit, nil)
	telemetry.Close()
}

// telemetryTransport goes straight to our API: pinned TLS, no proxy (the API
// host is also a direct rule inside the core, see service.DirectDomains).
func telemetryTransport() http.RoundTripper { return license.DirectTransport() }

const tmAIEnvFix = telemetry.AIEnvFix

// Run-and-record wrappers: call sites stay one line without new imports.
func tmRouteRun(f func(process, url string) service.RouteTestResult, process, url string) service.RouteTestResult {
	return tmRoute(time.Now(), f(process, url))
}

func tmSelfTestRun(f func() service.SelfTestReport) service.SelfTestReport {
	return tmSelfTest(time.Now(), f())
}

// tmTextRun records a "" / message binding of the named type.
func tmTextRun(typ string, payload map[string]any, f func() string) string {
	return tmText(typ, time.Now(), payload, f())
}

// tmCustomApps records the user-defined app catalog.
func tmCustomApps(apps []appid.App, f func([]appid.App) string) string {
	names := make([]string, 0, len(apps))
	for _, ap := range apps {
		names = append(names, ap.Name)
	}
	return tmText(telemetry.CustomAppChange, time.Now(), map[string]any{"apps": names}, f(apps))
}

// tmPowerVPN records POWER云 login / node refresh.
func tmPowerVPN(kind string, f func() string) string {
	typ := telemetry.PowerVPNNodes
	if kind == "login" {
		typ = telemetry.AccountLogin
	}
	return tmTextRun(typ, map[string]any{"method": "powervpn", "kind": kind}, f)
}

// tmLatencyAll records the batch latency test with per-protocol failures.
func (a *App) tmLatencyAll(start time.Time) {
	total, failed := map[string]any{}, map[string]any{}
	for _, n := range a.svc.Nodes() {
		c, _ := total[n.Type].(int)
		total[n.Type] = c + 1
		if n.Latency < 0 {
			f, _ := failed[n.Type].(int)
			failed[n.Type] = f + 1
		}
	}
	telemetry.Op(telemetry.NodeLatencyAll, start, nil, map[string]any{"total": total, "failed": failed})
}

// tmAdd records a paste import: schemes and counts only.
func tmAdd(text string, added, skipped int) {
	var err error
	if added == 0 {
		err = telemetry.Errorf("parse: no node recognised (%d skipped)", skipped)
	}
	telemetry.Op(telemetry.NodeAdd, time.Now(), err, map[string]any{"source": "paste", "schemes": schemesOf(text), "added": added, "skipped": skipped})
}

// urlHost keeps only the host of a subscription URL (paths carry tokens).
func urlHost(raw string) map[string]any {
	if u, err := url.Parse(strings.TrimSpace(raw)); err == nil {
		return map[string]any{"host": u.Hostname()}
	}
	return map[string]any{}
}

func (a *App) tmSub(id string) map[string]any {
	for _, s := range a.svc.GetSubs() {
		if s.ID == id {
			p := urlHost(s.URL)
			p["nodeCount"] = s.NodeCount
			return p
		}
	}
	return map[string]any{}
}

// tmCoreUpdate records a manual core update ("ERR:" prefix = failure).
func (a *App) tmCoreUpdate(start time.Time, res string) string {
	msg := ""
	if strings.HasPrefix(res, "ERR:") {
		msg = strings.TrimPrefix(res, "ERR:")
	}
	telemetry.FailText(telemetry.CoreUpdate, start, msg, map[string]any{"trigger": "ui", "version": a.svc.GetCoreVersion()})
	return res
}

// tmInstall records an app update download / install hand-off.
func tmInstall(start time.Time, version string, msg *string) {
	telemetry.FailText(telemetry.AppUpdate, start, *msg, map[string]any{"version": version})
}

// tmUpdateResult records the outcome seen by the first launch after an update.
func tmUpdateResult(from, to string, failed bool) {
	var err error
	if failed {
		err = telemetry.Errorf("update to v%s did not start; rolled back", to)
	}
	telemetry.Emit(telemetry.AppUpdateResult, telemetry.OK, err, map[string]any{"from": from, "to": to, "running": appVersion})
}

// tmNodeResolve records one node-domain pre-resolve (domain + IPs only).
func tmNodeResolve(r noderesolve.Result, err error) {
	telemetry.Emit(telemetry.NodeResolve, telemetry.Info, err, noderesolve.Payload(r, err))
}
