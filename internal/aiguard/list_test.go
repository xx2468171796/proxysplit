package aiguard

import (
	"slices"
	"testing"
)

func TestListCoversAIServices(t *testing.T) {
	for _, h := range []string{"api.anthropic.com", "claude.ai", "chatgpt.com", "ab.chatgpt.com", "cdn.oaistatic.com", "Claude.AI."} {
		if !Covers(h) {
			t.Errorf("%s not covered", h)
		}
	}
	for _, h := range []string{"baidu.com", "notanthropic.com", "google.com", "github.com"} {
		if Covers(h) {
			t.Errorf("%s must not be on the AI list", h)
		}
	}
}

// NRPT needs ".x" for subdomains and "x" for the name itself.
func TestNamespacesCoverNameAndSubdomains(t *testing.T) {
	ns := Namespaces()
	for _, want := range []string{".anthropic.com", "anthropic.com", ".claude.ai", "claude.ai", ".chatgpt.com", "chatgpt.com"} {
		if !slices.Contains(ns, want) {
			t.Errorf("namespace %s missing", want)
		}
	}
	if len(ns) != 2*len(DomainSuffixes())+len(Domains()) {
		t.Errorf("unexpected namespace count %d", len(ns))
	}
}

func TestExitRegionRisky(t *testing.T) {
	for _, cc := range []string{"CN", "hk", " MO ", ""} {
		if !ExitRegionRisky(cc) {
			t.Errorf("%q should be risky", cc)
		}
	}
	for _, cc := range []string{"TW", "US", "JP"} {
		if ExitRegionRisky(cc) {
			t.Errorf("%q should not be risky", cc)
		}
	}
}
