package aiguard

import (
	"slices"
	"testing"
)

// Claude (Claude Code CLI, desktop app, web) and OpenAI (ChatGPT, Codex CLI)
// hosts are hijacked and locked; other AI products and ordinary sites are not.
func TestScopeIsClaudeAndOpenAI(t *testing.T) {
	for _, h := range []string{
		"api.anthropic.com", "console.anthropic.com", "statsig.anthropic.com", "claude.ai", "www.claude.com", "Claude.AI.",
		"api.openai.com", "auth.openai.com", "chatgpt.com", "ab.chatgpt.com", "cdn.oaistatic.com", "files.oaiusercontent.com",
	} {
		if !Covers(h) || !Locked(h) {
			t.Errorf("%s must be hijacked and locked", h)
		}
	}
	if !Covers("challenges.cloudflare.com") || Locked("challenges.cloudflare.com") {
		t.Error("Cloudflare's sign-in check goes through the line but must not be locked")
	}
	for _, h := range []string{"gemini.google.com", "deepseek.com", "cursor.com", "githubcopilot.com", "baidu.com", "notanthropic.com", "google.com"} {
		if Covers(h) || Locked(h) {
			t.Errorf("%s is out of scope", h)
		}
	}
}

// NRPT needs ".x" for subdomains and "x" for the name itself.
func TestNamespacesCoverNameAndSubdomains(t *testing.T) {
	ns := Namespaces()
	for _, want := range []string{".anthropic.com", "anthropic.com", ".claude.ai", "claude.ai", ".chatgpt.com", "chatgpt.com", ".openai.com"} {
		if !slices.Contains(ns, want) {
			t.Errorf("namespace %s missing", want)
		}
	}
	if slices.Contains(ns, ".challenges.cloudflare.com") {
		t.Error("route-only domain locked")
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
