package core

import (
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

func reloadFixture(t *testing.T) (*Manager, *nodes.Node, Options) {
	t.Helper()
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	opts := matrixOpts(true)
	opts.GeoDir = geoDir
	opts.ClashController, opts.ClashSecret = "127.0.0.1:19090", "s"
	return NewManager(singboxPath(t), dir, nil), node, opts
}

// A reload validates the new config before the old core is stopped: what a
// start would run must pass, a config the core rejects must fail — and neither
// may leave anything behind or need a running core.
func TestCheckTUNValidatesWithoutStarting(t *testing.T) {
	m, node, opts := reloadFixture(t)
	if err := m.CheckTUN(node, "info", RouteBypassCN, opts); err != nil {
		t.Fatalf("TUN config a start would use must validate: %v", err)
	}
	proc := opts
	ports := map[string]int{}
	for i, tag := range ProcessInbounds(proc) {
		ports[tag] = 20000 + i
	}
	proc.Process = &ProcessCapture{Ports: ports}
	if err := m.CheckTUN(node, "info", RouteBypassCN, proc); err != nil {
		t.Fatalf("process-capture config must validate: %v", err)
	}
	if err := m.checkConfig([]byte(`{"outbounds":[{"type":"no-such-protocol","tag":"proxy"}]}`)); err == nil {
		t.Fatal("a config sing-box rejects must fail the check")
	}
	if m.Running() {
		t.Fatal("checking must not start the core")
	}
}

// An unchanged config is recognised (no restart needed); any option that
// changes the generated config is not.
func TestRunningConfigIs(t *testing.T) {
	m, node, opts := reloadFixture(t)
	cfg, _, err := m.tunConfig(node, "info", RouteBypassCN, nil, m.xrayOpts(opts, nil))
	if err != nil {
		t.Fatal(err)
	}
	if same, _ := m.RunningConfigIs(node, "info", RouteBypassCN, opts); same {
		t.Fatal("a stopped core runs no config")
	}
	m.running, m.tunCfg = true, cfg
	if same, err := m.RunningConfigIs(node, "info", RouteBypassCN, opts); err != nil || !same {
		t.Fatalf("identical options must compare equal (same=%v err=%v)", same, err)
	}
	changed := opts
	changed.BlockQUIC = !changed.BlockQUIC
	if same, _ := m.RunningConfigIs(node, "info", RouteBypassCN, changed); same {
		t.Fatal("a changed option must not compare equal")
	}
	if same, _ := m.RunningConfigIs(node, "debug", RouteBypassCN, opts); same {
		t.Fatal("a changed log level must not compare equal")
	}
}
