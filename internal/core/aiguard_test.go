package core

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

func guardFor(out string) *AIGuard {
	return &AIGuard{DomainSuffixes: []string{"anthropic.com", "chatgpt.com"}, IPCIDRs: []string{"160.79.104.0/23"}, Outbound: out}
}

// TestRoutingMatrixAIGuard: with the guard on, AI goes through the guard's line
// from every app placement and in every 代理策略 — 直连 apps and 代理策略 直连
// included — while everything else keeps its normal route. Only 拦截 (the
// user's explicit "cut this app off") still wins.
func TestRoutingMatrixAIGuard(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	for _, c := range []struct {
		where       string
		whitelist   bool
		foreign, cn string // in 规则 mode, unchanged by the guard
		ai          string
	}{
		{"未列出", true, "direct", "direct", "node-x"},
		{"未列出", false, "proxy", "direct", "node-x"},
		{"直连", true, "direct", "direct", "node-x"},
		{"规则", true, "proxy", "direct", "node-x"},
		{"全局", false, "proxy", "proxy", "node-x"},
		{"拦截", true, "reject", "reject", "reject"},
	} {
		name := fmt.Sprintf("AI锁/白名单=%v/应用=%s", c.whitelist, c.where)
		t.Run(name, func(t *testing.T) {
			opts := placement(matrixOpts(c.whitelist), proc, c.where)
			opts.AIGuard = guardFor("node-x")
			m := newMatrix(t, opts)
			m.expect(name, "rule", map[string]string{matrixAI: c.ai, matrixForeign: c.foreign, matrixCN: c.cn})
			m.expect(name, "global", map[string]string{matrixAI: c.ai})
			m.expect(name, "direct", map[string]string{matrixAI: c.ai})
		})
	}
}

// TestRoutingMatrixAIGuardRestricted: a 仅 AI line whose allowlist misses an AI
// domain must not send that domain direct (restrictEgress leaves the guard
// alone); no line available = AI unreachable, never direct.
func TestRoutingMatrixAIGuardRestricted(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	aiOnly := &nodes.Egress{Mode: "ai_only", Allow: &nodes.EgressAllow{DomainSuffixes: []string{"openai.com"}}}
	opts := placement(matrixOpts(true), proc, "未列出")
	opts.AIGuard = guardFor("proxy")
	m := newMatrixEgress(t, opts, aiOnly)
	m.expect("仅AI+AI锁", "rule", map[string]string{matrixAI: "proxy", matrixForeign: "direct"})
	m.expect("仅AI+AI锁", "direct", map[string]string{matrixAI: "proxy"})

	opts = placement(matrixOpts(false), proc, "全局")
	opts.AIGuard = guardFor("reject")
	m2 := newMatrix(t, opts)
	m2.expect("AI锁无线路", "rule", map[string]string{matrixAI: "reject", matrixForeign: "proxy"})
	m2.expect("AI锁无线路", "direct", map[string]string{matrixAI: "reject"})
}

// TestAIGuardConfig: the generated config passes the real core's check; AI
// names resolve first through the guard's own line with IPv6-bearing answers
// blanked (no deprecated DNS `strategy`); the lock's loopback DNS listener is
// hijacked first; AI QUIC is rejected before the AI route.
func TestAIGuardConfig(t *testing.T) {
	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	extra, _ := nodes.ParseLink(sampleLinks["trojan"])
	guard := guardFor("node-x")
	guard.DNSListen = "127.0.0.53"
	opts := Options{Split: true, SplitWhitelist: true, RemoteDNS: true, RuleDir: t.TempDir(), GeoDir: filepath.Join("..", "..", "bin"),
		ExtraNodes: []ExtraNode{{Tag: "node-x", Node: extra}}, AIGuard: guard}
	raw, err := BuildTUNConfig(node, "warn", opts)
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		DNS struct {
			Servers []M `json:"servers"`
			Rules   []M `json:"rules"`
		} `json:"dns"`
		Inbounds []M `json:"inbounds"`
		Route    struct {
			Rules []M `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	noV6, route := cfg.DNS.Rules[0], cfg.DNS.Rules[1]
	if noV6["action"] != "predefined" || noV6["rcode"] != "NOERROR" || noV6["query_type"] == nil || noV6["domain_suffix"] == nil {
		t.Fatalf("first DNS rule (blank AAAA / HTTPS) = %v", noV6)
	}
	if route["server"] != aiDNSServer || route["strategy"] != nil {
		t.Fatalf("second DNS rule = %v", route)
	}
	listener := false
	for _, in := range cfg.Inbounds {
		listener = listener || (in["tag"] == aiDNSInbound && in["listen"] == "127.0.0.53")
	}
	if !listener || cfg.Route.Rules[0]["action"] != "hijack-dns" || cfg.Route.Rules[0]["inbound"] == nil {
		t.Fatalf("loopback DNS listener / hijack missing: inbounds %v, first rule %v", cfg.Inbounds, cfg.Route.Rules[0])
	}
	found := false
	for _, s := range cfg.DNS.Servers {
		if s["tag"] == aiDNSServer && s["detour"] == "node-x" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no dns-ai server through node-x: %v", cfg.DNS.Servers)
	}
	quicAt, routeAt := -1, -1
	for i, r := range cfg.Route.Rules {
		if r["domain_suffix"] == nil {
			continue
		}
		if r["action"] == "reject" && quicAt < 0 {
			quicAt = i
		}
		if r["outbound"] == "node-x" && routeAt < 0 {
			routeAt = i
		}
	}
	if quicAt < 0 || routeAt != quicAt+1 {
		t.Fatalf("AI QUIC reject at %d, AI route at %d", quicAt, routeAt)
	}

	if _, err := os.Stat(singboxPath(t)); err != nil {
		t.Skip("no bundled core")
	}
	p := filepath.Join(t.TempDir(), "ai.json")
	os.WriteFile(p, raw, 0o600)
	for tag, data := range SplitRuleSets(opts) {
		os.WriteFile(filepath.Join(opts.RuleDir, tag+".json"), data, 0o600)
	}
	if out, err := exec.Command(singboxPath(t), "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check: %v\n%s", err, out)
	}
}

// TestAIGuardOff: no guard = config identical to before (no AI rules at all).
func TestAIGuardOff(t *testing.T) {
	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	opts := Options{Split: true, SplitWhitelist: true, RuleDir: t.TempDir()}
	a, _ := BuildTUNConfig(node, "warn", opts)
	opts.AIGuard = &AIGuard{Outbound: "proxy"} // empty list = inactive
	b, _ := BuildTUNConfig(node, "warn", opts)
	if string(a) != string(b) {
		t.Fatal("an inactive guard changed the config")
	}
}
