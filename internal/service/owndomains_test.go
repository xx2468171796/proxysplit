package service

import (
	"strings"
	"testing"

	"proxysplit/internal/aiguard"
)

// Our own relay stations (*.zygskins.cn) must never be hijacked or locked:
// customers reach Claude / Codex through them, and the AI lock would cut them
// off (owner, 2026-10-23: hijack only the official AI services).
func TestOwnRelaysNeverHijacked(t *testing.T) {
	for _, host := range []string{"zygskins.cn", "ai.zygskins.cn", "sub2api.zygskins.cn", "codex.demo.zygskins.cn"} {
		if aiguard.Covers(host) {
			t.Errorf("%s is routed by the AI hijack", host)
		}
		if !coveredBy(host, DirectDomains("")) {
			t.Errorf("%s is not always-direct", host)
		}
	}
	for _, ns := range aiguard.Namespaces() {
		if strings.Contains(ns, "zygskins") {
			t.Errorf("NRPT lock covers our own domain %s", ns)
		}
	}
	for _, s := range aiguard.DomainSuffixes() {
		if coveredBy(s, ownDomesticSuffixes) {
			t.Errorf("AI hijack list contains our own domain %s", s)
		}
	}
}
