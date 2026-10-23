package service

import (
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

func guardService(t *testing.T, list ...*nodes.Node) *Service {
	t.Helper()
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.cfg.Nodes = list
	s.cfg.SelectedID = list[0].ID
	s.aiGuard = true
	s.mu.Unlock()
	return s
}

func testNode(t *testing.T, id string, official bool) *nodes.Node {
	t.Helper()
	n, err := nodes.ParseLink(testLink)
	if err != nil {
		t.Fatal(err)
	}
	n.ID, n.Name, n.Official = id, id, official
	return n
}

// AI uses the active node when it is ours, else our first node (as an extra
// outbound), else the active node — never direct.
func TestAIGuardPicksOurLine(t *testing.T) {
	for _, c := range []struct {
		name string
		list []*nodes.Node
		want string
	}{
		{"active is ours", []*nodes.Node{testNode(t, "pv1", true), testNode(t, "pv2", true)}, "proxy"},
		{"active is third-party", []*nodes.Node{testNode(t, "x", false), testNode(t, "pv1", true)}, "node-pv1"},
		{"none of ours", []*nodes.Node{testNode(t, "x", false)}, "proxy"},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := guardService(t, c.list...)
			for _, whitelist := range []bool{true, false} {
				opts := splitOpts(t, s, c.list[0], whitelist)
				if opts.AIGuard == nil || opts.AIGuard.Outbound != c.want {
					t.Fatalf("whitelist=%v: AI outbound = %+v, want %s", whitelist, opts.AIGuard, c.want)
				}
				if len(opts.AIGuard.DomainSuffixes) == 0 {
					t.Fatal("AI guard without domains")
				}
				if strings.HasPrefix(c.want, "node-") {
					found := false
					for _, en := range opts.ExtraNodes {
						found = found || en.Tag == c.want
					}
					if !found {
						t.Fatalf("AI line %s not registered as an extra node", c.want)
					}
				}
				if c.name != "none of ours" && opts.AccelOutbound != c.want {
					t.Fatalf("Claude Code accelerator on %s, want the AI line %s", opts.AccelOutbound, c.want)
				}
			}
		})
	}
}

func TestAIGuardOffLeavesConfigAlone(t *testing.T) {
	s := guardService(t, testNode(t, "pv1", true))
	s.mu.Lock()
	s.aiGuard = false
	s.mu.Unlock()
	if opts := splitOpts(t, s, s.cfg.Nodes[0], true); opts.AIGuard != nil {
		t.Fatalf("guard off but AIGuard = %+v", opts.AIGuard)
	}
}

func TestAIEnvVerdicts(t *testing.T) {
	if it := exitItem(traceResult{ip: "1.2.3.4", loc: "TW"}); it.Status != "ok" {
		t.Errorf("TW exit = %s", it.Status)
	}
	for _, loc := range []string{"CN", "HK", ""} {
		if it := exitItem(traceResult{ip: "1.2.3.4", loc: loc}); it.Status != "fail" {
			t.Errorf("exit %q = %s, want fail", loc, it.Status)
		}
	}
	if it := exitItem(traceResult{ip: "1.2.3.4", loc: "US"}); it.Status != "warn" {
		t.Errorf("US exit = %s, want warn", it.Status)
	}
	if it := exitItem(traceResult{err: errors.New("timeout")}); it.Status != "fail" {
		t.Errorf("unreachable = %s", it.Status)
	}
	v4 := []net.IPAddr{{IP: net.ParseIP("160.79.104.10")}}
	if it := dnsItem(v4, nil); it.Status != "ok" {
		t.Errorf("v4 answer = %s", it.Status)
	}
	if it := dnsItem(append(v4, net.IPAddr{IP: net.ParseIP("2607:6bc0::10")}), nil); it.Status != "warn" {
		t.Errorf("AAAA answer = %s, want warn", it.Status)
	}
	if it := dnsItem(nil, errors.New("no such host")); it.Status != "fail" {
		t.Errorf("lookup failure = %s", it.Status)
	}
	if it := clockItem(traceResult{ip: "1.2.3.4", skew: -10 * time.Minute}); it.Status != "fail" || it.Fix != "clock" {
		t.Errorf("10 min skew = %+v", it)
	}
	if it := clockItem(traceResult{ip: "1.2.3.4", skew: 3 * time.Second}); it.Status != "ok" {
		t.Errorf("3 s skew = %s", it.Status)
	}
	if it := autostartItem(false); it.Fix != "autostart" {
		t.Errorf("autostart off without fix: %+v", it)
	}
}
