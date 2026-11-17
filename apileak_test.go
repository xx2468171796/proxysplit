package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/powervpn"
	"proxysplit/internal/service"
)

// plantedSecrets are values stored in the fixture below that must never appear
// in any answer of the control surface (HTTP route or MCP tool).
var plantedSecrets = []string{
	"PLANTED-trojan-password",
	"0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9", // vless uuid
	"PLANTED-reality-short-id",
	"PLANTED-raw-outbound-password",
	"PLANTED-share-link",
	"PLANTED-sub-token",
	"PLANTED-lan-password",
	"PLANTED-port-password",
	"PLANTED-control-token",
	"PLANTED-core-config-password",
	"PLANTED-log-secret",
	"PLANTED-plugin-opts",
	"PLANTED-key-passphrase",
}

const leakFixtureConfig = `{
 "nodes": [
  {"id":"n-trojan","name":"t1","type":"trojan","server":"node1.proxysplit.test","port":443,
   "password":"PLANTED-trojan-password","raw":"trojan://PLANTED-share-link@node1.proxysplit.test:443#t1",
   "plugin":"obfs-local","pluginOpts":"obfs=http;obfs-host=PLANTED-plugin-opts"},
  {"id":"n-vless","name":"v1","type":"vless","server":"node2.proxysplit.test","port":443,
   "uuid":"0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9","security":"reality","shortId":"PLANTED-reality-short-id",
   "official":true,"accountId":"acct-1","officialKey":"acct-1/relay:1"},
  {"id":"n-raw","name":"group","type":"group","server":"node3.proxysplit.test","port":443,"entryTag":"g",
   "outbounds":[{"type":"trojan","tag":"g","server":"node3.proxysplit.test","server_port":443,"password":"PLANTED-raw-outbound-password"}]}
 ],
 "selectedId": "n-trojan",
 "rules": [{"match":"chrome.exe","path":"chrome.exe","line":"rule","enabled":true}],
 "subs": [{"id":"s1","name":"sub","url":"https://sub.proxysplit.test/link/PLANTED-sub-token?token=PLANTED-sub-token"}],
 "settings": {"theme":"dark","lanShare":true,"lanUser":"lan","lanPass":"PLANTED-lan-password"},
 "proxyPorts": [{"id":"p1","name":"port","port":17001,"protocol":"socks","user":"u","pass":"PLANTED-port-password"}],
 "apiToken": "PLANTED-control-token",
 "connectivityProbeVersion": 2
}`

const leakFixtureCoreConfig = `{"outbounds":[
 {"type":"trojan","tag":"node-n-trojan","server":"node1.proxysplit.test","server_port":443,"password":"PLANTED-core-config-password"},
 {"type":"vless","tag":"node-n-vless","server":"node2.proxysplit.test","uuid":"0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9",
  "tls":{"reality":{"enabled":true,"short_id":"PLANTED-reality-short-id"}}},
 {"type":"shadowsocks","tag":"ss-plugin","server":"node4.proxysplit.test","method":"aes-128-gcm","password":"PLANTED-core-config-password",
  "plugin":"obfs-local","plugin_opts":"obfs=http;obfs-host=PLANTED-plugin-opts"},
 {"type":"ssh","tag":"ssh-key","server":"node5.proxysplit.test","user":"root","private_key_path":"key.pem",
  "private_key_passphrase":"PLANTED-key-passphrase"}],
 "inbounds":[{"type":"mixed","users":[{"username":"lan","password":"PLANTED-lan-password"}]}]}`

// leakFixtureApp is an App whose stored state is full of planted secrets.
func leakFixtureApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(leakFixtureConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sing-box.json"), []byte(leakFixtureCoreConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	svc, err := service.New(t.TempDir(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(svc.Nodes()) != 3 || svc.GetSettings().LanPass != "PLANTED-lan-password" {
		t.Fatalf("fixture did not load: %d nodes", len(svc.Nodes()))
	}
	// What the core and the subscription updater really write to the log.
	svc.LogLine(`[sub] 订阅更新失败: Get "https://sub.proxysplit.test/link/PLANTED-log-secret?token=PLANTED-log-secret": timeout`)
	svc.LogLine(`[core] outbound trojan://PLANTED-log-secret@node1.proxysplit.test:443 failed, password=PLANTED-log-secret`)
	svc.LogLine(`[core] outbound/shadowsocks[ss-plugin]: plugin_opts=obfs=http;obfs-host=PLANTED-plugin-opts rejected`)
	svc.LogLine(`[core] decode config: "plugin_opts":"obfs=tls;obfs-host=PLANTED-plugin-opts" unsupported`)
	svc.LogLine(`[core] outbound/ssh[ssh-key]: "private_key_passphrase":"PLANTED-key-passphrase" wrong`)
	a := &App{svc: svc, ready: make(chan struct{}), pv: powervpn.New(dir, appVersion)}
	close(a.ready)
	return a
}

func assertNoPlantedSecret(t *testing.T, where, body string) {
	t.Helper()
	for _, secret := range plantedSecrets {
		if strings.Contains(body, secret) {
			t.Errorf("%s leaks %q", where, secret)
		}
	}
}

// Operations the sweep must not run in a unit test, with the reason. Their
// answers are built by the same shared functions (apiops.go); the ones that
// quote logs are covered by TestProbeResultsAreSanitized.
var (
	leakSweepSkipHTTP = map[string]string{
		"GET /api/hello":            "open handshake path, covered by TestHelloProvesTheNonceWithoutAToken",
		"POST /api/start":           "launches the core",
		"POST /api/restart":         "launches the core",
		"POST /api/stop":            "touches system proxy state",
		"POST /api/diag/selftest":   "real network probes, about a minute",
		"GET /api/exits":            "real network probes",
		"GET /api/ai-env":           "inspects and probes the real system",
		"POST /api/ai-env/fix":      "changes the real system",
		"POST /api/account/login":   "calls the licence server",
		"POST /api/reset":           "clears real system state",
		"POST /api/reset/undo":      "restores a backup over the fixture",
		"POST /api/nodes/remove":    "would remove the fixture it sweeps",
		"POST /api/settings/net":    "restarts the core on change",
		"POST /api/nodes/add":       "covered by the MCP tool with the same function",
		"POST /api/apps/remove":     "covered by the MCP tool with the same function",
		"POST /api/custom-rules":    "covered by the MCP tool with the same function",
		"POST /api/split-mode":      "covered by the MCP tool with the same function",
		"POST /api/diag/route-test": "covered by the MCP tool with the same function",
	}
	leakSweepSkipMCP = map[string]string{
		"proxysplit_start":      "launches the core",
		"proxysplit_stop":       "touches system proxy state",
		"proxysplit_selftest":   "real network probes, about a minute",
		"proxysplit_reset_undo": "restores a backup over the fixture",
		"proxysplit_set_dns":    "restarts the core on change",
	}
)

var leakSweepHTTPBodies = map[string]string{
	"POST /api/node/select": `{"id":"n-vless"}`,
	"POST /api/apps":        `{"match":"git.exe","line":"global","node":"n-raw"}`,
	"POST /api/mode":        `{"clash":"rule"}`,
	"POST /api/nodes/core":  `{"id":"n-trojan","core":"auto"}`,
	"POST /api/nodes/via":   `{"id":"n-trojan","via":""}`,
	"POST /api/settings":    `{"blockQUIC":false}`,
	"POST /api/log-level":   `{"level":"info"}`,
	"POST /mcp":             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
}

var leakSweepMCPArgs = map[string]string{
	"proxysplit_select_node":      `{"id":"n-vless"}`,
	"proxysplit_set_app":          `{"match":"curl.exe","line":"global","node":"n-raw"}`,
	"proxysplit_remove_app":       `{"match":"curl.exe"}`,
	"proxysplit_set_mode":         `{"clash":"rule"}`,
	"proxysplit_route_test":       `{"process":"chrome.exe","url":"not-a-url"}`,
	"proxysplit_logs":             `{"n":500}`,
	"proxysplit_set_custom_rules": `{"rules":[{"type":"suffix","value":"proxysplit.test","action":"direct"}]}`,
	"proxysplit_set_settings":     `{"settings":{"blockQUIC":false}}`,
	"proxysplit_add_nodes":        `{"text":"trojan://another-password@node9.proxysplit.test:443#t9"}`,
	"proxysplit_set_split_mode":   `{"mode":"whitelist"}`,
	"proxysplit_set_node_via":     `{"id":"n-trojan","via":""}`,
}

// No answer of the control surface — any HTTP route, any MCP tool — may
// contain a node credential, share link, raw outbound, subscription URL, LAN /
// port-proxy password or the control token. Every route and tool is either
// exercised here or listed as skipped with its reason, so a new one cannot be
// added without deciding.
func TestControlSurfaceNeverLeaksNodeSecrets(t *testing.T) {
	a := leakFixtureApp(t)

	for _, route := range a.controlRoutes() {
		for method, handler := range map[string]http.HandlerFunc{http.MethodGet: route.get, http.MethodPost: route.post} {
			if handler == nil {
				continue
			}
			key := method + " " + route.path
			if _, skip := leakSweepSkipHTTP[key]; skip {
				continue
			}
			body, known := leakSweepHTTPBodies[key]
			if method == http.MethodPost && !known {
				t.Errorf("%s: new mutating route — add a request body to leakSweepHTTPBodies or a reason to leakSweepSkipHTTP", key)
				continue
			}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(method, route.path+"?n=500", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			handler(rec, req)
			answer, _ := io.ReadAll(rec.Result().Body)
			if rec.Code != http.StatusOK {
				t.Errorf("%s: status %d: %s", key, rec.Code, answer)
			}
			assertNoPlantedSecret(t, key, string(answer))
		}
	}

	for _, tool := range mcpTools() {
		name, _ := tool["name"].(string)
		if _, skip := leakSweepSkipMCP[name]; skip {
			continue
		}
		args := leakSweepMCPArgs[name]
		if args == "" {
			args = `{}`
		}
		assertNoPlantedSecret(t, "MCP "+name, a.mcpCall(name, json.RawMessage(args)))
		catalog, _ := json.Marshal(tool)
		assertNoPlantedSecret(t, "MCP catalog "+name, string(catalog))
	}

	// The sweep itself must have had something to find.
	if got := a.apiLogs(500, ""); len(got) < 2 {
		t.Fatalf("fixture log lines missing: %v", got)
	}
	if !strings.Contains(a.mcpCall("proxysplit_list_nodes", nil), "node1.proxysplit.test") {
		t.Fatal("node list no longer shows the fixture nodes")
	}
}

// Probe results quote core log lines; the shared functions clean them.
func TestProbeResultsAreSanitized(t *testing.T) {
	leaky := service.RouteTestResult{
		Error:    `Get "https://sub.proxysplit.test/link/PLANTED-log-secret": EOF`,
		LogTrace: []string{`outbound trojan://PLANTED-log-secret@node1.proxysplit.test:443`, `uuid=0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9`},
	}
	one, _ := json.Marshal(sanitizeRouteTest(leaky))
	assertNoPlantedSecret(t, "route test", string(one))
	if !strings.Contains(string(one), "sub.proxysplit.test") {
		t.Fatalf("sanitising removed the host an AI needs for diagnosis: %s", one)
	}
	report, _ := json.Marshal(sanitizeSelfTest(service.SelfTestReport{
		DNSLogs: []string{`dns: exchange failed, password=PLANTED-log-secret`},
		Cases:   []service.SelfTestCase{{Process: "chrome.exe", Result: leaky}},
	}))
	assertNoPlantedSecret(t, "self test", string(report))
}

// A settings object read from the API and posted back whole must not replace
// the stored LAN password with the mask.
func TestSettingsRoundTripKeepsMaskedLanPassword(t *testing.T) {
	a := leakFixtureApp(t)
	shown, _ := json.Marshal(a.apiSettings())
	if strings.Contains(string(shown), "PLANTED-lan-password") || !strings.Contains(string(shown), maskedSecret) {
		t.Fatalf("settings not masked: %s", shown)
	}
	if msg, err := a.apiSetSettings(shown); err != nil || msg != "" {
		t.Fatalf("round trip failed: %q %v", msg, err)
	}
	if got := a.svc.GetSettings().LanPass; got != "PLANTED-lan-password" {
		t.Fatalf("stored LAN password became %q", got)
	}
}
