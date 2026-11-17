package service

import (
	"errors"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

// reloadTrace records which reload steps ran.
type reloadTrace struct {
	steps    []string
	same     bool
	checkErr error
	swapErr  error
}

func (r *reloadTrace) ops() reloadOps {
	return reloadOps{
		unchanged: func() bool { r.steps = append(r.steps, "compare"); return r.same },
		check:     func() error { r.steps = append(r.steps, "check"); return r.checkErr },
		swap:      func() error { r.steps = append(r.steps, "swap"); return r.swapErr },
	}
}

// A scheduled subscription refresh that changed nothing must not restart the
// core (every connection reset, seconds without the proxy).
func TestReloadSkipsIdenticalConfig(t *testing.T) {
	r := &reloadTrace{same: true}
	if err := reloadSteps(false, r.ops()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(r.steps, ","); got != "compare" {
		t.Fatalf("steps = %s, want compare only", got)
	}
}

// A config the core rejects must leave the working core alone.
func TestReloadKeepsOldCoreWhenNewConfigIsInvalid(t *testing.T) {
	r := &reloadTrace{checkErr: errors.New("unknown outbound")}
	err := reloadSteps(false, r.ops())
	if err == nil || !strings.Contains(err.Error(), "unknown outbound") {
		t.Fatalf("err = %v", err)
	}
	if got := strings.Join(r.steps, ","); got != "compare,check" {
		t.Fatalf("steps = %s: the old core must not be stopped", got)
	}
}

// A changed config is validated first, then swapped; a forced restart (new
// core binary, rule files) skips the comparison but not the validation.
func TestReloadValidatesBeforeSwapping(t *testing.T) {
	r := &reloadTrace{}
	if err := reloadSteps(false, r.ops()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(r.steps, ","); got != "compare,check,swap" {
		t.Fatalf("steps = %s", got)
	}
	forced := &reloadTrace{same: true}
	if err := reloadSteps(true, forced.ops()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(forced.steps, ","); got != "check,swap" {
		t.Fatalf("forced steps = %s", got)
	}
}

// A reload keeps the address the running core dials for a node, so a fresh
// lookup that returns another IP does not turn "nothing changed" into a
// restart. (No resolver exists in this bare service: touching it would panic.)
func TestReloadKeepsResolvedNodeIPs(t *testing.T) {
	s := &Service{onLog: func(string) {}}
	list := []*nodes.Node{{ID: "a", Type: "vless", Server: "hk1.node-test.net", Port: 443}, {ID: "b", Type: "vless", Server: "203.0.113.9", Port: 443}}
	got := s.serverIPsKeeping(list, map[string]string{"hk1.node-test.net": "198.51.100.7", "gone.node-test.net": "198.51.100.8"})
	if len(got) != 1 || got["hk1.node-test.net"] != "198.51.100.7" {
		t.Fatalf("serverIPsKeeping = %v", got)
	}
}
