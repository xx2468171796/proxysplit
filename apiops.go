package main

import (
	"encoding/json"
	"strings"

	"proxysplit/internal/service"
	"proxysplit/internal/telemetry"
)

// Operations of the local control surface. The HTTP routes (apiserver.go,
// diagapi.go) and the MCP tools call the same function for the same operation,
// and every function here returns data that is safe to hand to an AI agent:
// no node credentials, share links, raw outbounds, subscription URLs, LAN
// proxy password or control token. A new operation that returns data goes
// here, never straight from a.svc into one of the two transports
// (TestControlSurfaceNeverLeaksNodeSecrets sweeps both).

// maskedSecret stands in for a secret that exists but is not shown.
const maskedSecret = "***"

// apiNode is a node as the control surface shows it: enough to pick one.
type apiNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Server   string `json:"server"`
	Port     int    `json:"port"`
	Official bool   `json:"official,omitempty"` // POWER云 node
	Via      string `json:"via,omitempty"`      // front node id (前置代理)
	Selected bool   `json:"selected,omitempty"`
}

func (a *App) apiNodes() []apiNode {
	selected := a.svc.Status().SelectedID
	out := []apiNode{}
	for _, n := range a.svc.Nodes() {
		if n == nil {
			continue
		}
		out = append(out, apiNode{ID: n.ID, Name: n.Name, Type: n.Type, Server: n.Server, Port: n.Port, Official: n.Official, Via: n.Via, Selected: n.ID == selected})
	}
	return out
}

func (a *App) apiStatus() map[string]any {
	st := a.svc.Status()
	return map[string]any{
		"running": st.CoreRunning || st.EngineRunning,
		"node":    st.NodeName,
		"nodeId":  st.SelectedID,
		"mode":    a.svc.GetClashMode(),
		"apps":    a.svc.GetAppRules(),
	}
}

func (a *App) apiAccount() map[string]any {
	return map[string]any{"license": a.GetLicenseStatus(), "powervpn": a.GetPowerVPNStatus()}
}

// apiSettings is the settings object with the LAN proxy password masked.
func (a *App) apiSettings() service.Settings {
	set := a.GetSettings()
	if set.LanPass != "" {
		set.LanPass = maskedSecret
	}
	return set
}

// apiSetSettings overlays patch (a JSON object holding only the fields to
// change) on the current settings. The error is a malformed patch; the string
// is SetSettings' own "" / failure message. A LanPass sent back as the mask
// (read with apiSettings, then posted whole) keeps the stored password.
func (a *App) apiSetSettings(patch []byte) (string, error) {
	set := a.GetSettings()
	stored := set.LanPass
	if err := json.Unmarshal(patch, &set); err != nil {
		return "", err
	}
	if set.LanPass == maskedSecret {
		set.LanPass = stored
	}
	return a.SetSettings(set), nil
}

// apiLogs returns recent log lines with secrets removed: core and subscription
// errors quote share links, subscription URLs (token in the path or query),
// UUIDs and keys.
func (a *App) apiLogs(n int, grep string) []string {
	return sanitizeLines(a.svc.RecentLogs(n, grep))
}

func (a *App) apiRouteTest(process, url string) service.RouteTestResult {
	return sanitizeRouteTest(a.svc.RouteTest(process, strings.TrimSpace(url)))
}

func (a *App) apiSelfTest() service.SelfTestReport {
	return sanitizeSelfTest(tmSelfTestRun(a.svc.SelfTest))
}

func sanitizeLines(lines []string) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = telemetry.Sanitize(l)
	}
	return out
}

// sanitizeRouteTest cleans the parts of a probe result that quote core logs.
func sanitizeRouteTest(res service.RouteTestResult) service.RouteTestResult {
	if res.LogTrace != nil {
		res.LogTrace = sanitizeLines(res.LogTrace)
	}
	res.Error = telemetry.Sanitize(res.Error)
	return res
}

func sanitizeSelfTest(rep service.SelfTestReport) service.SelfTestReport {
	if rep.DNSLogs != nil {
		rep.DNSLogs = sanitizeLines(rep.DNSLogs)
	}
	cases := make([]service.SelfTestCase, len(rep.Cases))
	for i, c := range rep.Cases {
		c.Result = sanitizeRouteTest(c.Result)
		cases[i] = c
	}
	rep.Cases = cases
	return rep
}
