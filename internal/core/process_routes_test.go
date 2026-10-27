package core

import (
	"testing"

	"proxysplit/internal/capture"
	"proxysplit/internal/nodes"
)

// TestProcessRoutesExcludeProcessPathRules: every process_path → direct rule
// the TUN tree carries (dropped from the process config) must become an engine
// exclusion, or 默认全走代理 captures xray / 端口代理 and loops their upstream.
func TestProcessRoutesExcludeProcessPathRules(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := processOpts(t, false) // 默认全走代理
	opts.XrayPath = `C:\ps\bin\xray.exe`
	tree, err := buildTUNTree(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	r := ProcessRoutes(opts)
	var seen int
	for _, rule := range tree["route"].(M)["rules"].([]M) {
		paths, ok := rule["process_path"].([]string)
		if !ok {
			continue
		}
		for _, p := range paths {
			seen++
			if got := r.Decide(p); got != (capture.Verdict{}) {
				t.Errorf("process_path %s must never be captured, got %+v", p, got)
			}
		}
	}
	if seen < 2 {
		t.Fatalf("expected the 端口代理 and xray process_path rules, saw %d", seen)
	}
	if got := r.Decide(`c:/PS/bin/XRAY.exe`); got != (capture.Verdict{}) {
		t.Errorf("exclusion must ignore case / slashes, got %+v", got)
	}
	if got := r.Decide(`C:\other\xray.exe`); got.Action != capture.Proxy {
		t.Errorf("an unrelated xray.exe follows the lists, got %+v", got)
	}
}
