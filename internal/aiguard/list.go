// Package aiguard keeps AI-service traffic of AI-site (aigw) customers on our
// own line: the destination list, and the Windows NRPT lock that makes those
// domains unresolvable whenever ProxySplit's tunnel is not up (fail-closed —
// never reach an account-sensitive AI service from the customer's own,
// mainland IP).
//
// Scope (owner, 2026-10-21): Claude (Claude Code CLI, the Claude desktop app,
// claude.ai) and OpenAI (ChatGPT web / app, Codex CLI) only — the services our
// relay customers' accounts live on. Other AI products are not hijacked: the
// lock would leave them unusable whenever ProxySplit is off. The domains are the
// Claude / OpenAI part of the company rule pack's "ai" category (powervpn repo
// packages/core/data/rulepack/ai.json).
package aiguard

import "strings"

// lockSuffixes are hijacked AND locked (unresolvable while ProxySplit is off).
var lockSuffixes = []string{
	// Claude: api / console / statsig.anthropic.com, claude.ai (web, desktop
	// app, Claude Code OAuth login), claude.com, file previews.
	"anthropic.com", "claude.ai", "claude.com", "claudeusercontent.com",
	// OpenAI: api / auth.openai.com, chatgpt.com (web, app, Codex CLI backend),
	// static and user content, chat.com / sora.com.
	"openai.com", "chatgpt.com", "chat.com", "oaistatic.com", "oaiusercontent.com", "sora.com",
}

// routeOnlySuffixes go through the AI line too but are not locked: shared by
// many other sites. challenges.cloudflare.com is the human check on the
// claude.ai / chatgpt.com sign-in pages — it must see the same IP as the site.
var routeOnlySuffixes = []string{"challenges.cloudflare.com"}

// ipCIDRs are Anthropic's own ranges (claude.ai, api.anthropic.com) for
// traffic dialled by IP.
var ipCIDRs = []string{"160.79.104.0/23", "2607:6bc0::/48"}

// DomainSuffixes are routed through the AI line (each matches itself and every
// subdomain, sing-box domain_suffix semantics).
func DomainSuffixes() []string {
	return append(append([]string(nil), lockSuffixes...), routeOnlySuffixes...)
}

// Domains are exact-match AI hosts (none at the moment).
func Domains() []string { return nil }

// IPCIDRs are AI providers' own address ranges.
func IPCIDRs() []string { return append([]string(nil), ipCIDRs...) }

// Namespaces is the NRPT namespace list for the lock: ".x" covers the
// subdomains of x and "x" the name itself (NRPT has no single entry for both).
func Namespaces() []string {
	out := make([]string, 0, 2*len(lockSuffixes))
	for _, s := range lockSuffixes {
		out = append(out, "."+s, s)
	}
	return out
}

// Covers reports whether host is hijacked (routed through the AI line).
func Covers(host string) bool { return matches(host, DomainSuffixes()) }

// Locked reports whether host is unresolvable while ProxySplit is off.
func Locked(host string) bool { return matches(host, lockSuffixes) }

func matches(host string, suffixes []string) bool {
	h := strings.Trim(strings.ToLower(host), ".")
	for _, s := range suffixes {
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	return false
}

// webRTCProcesses are the programs whose WebRTC STUN goes through the AI line
// while the guard is on: browsers (claude.ai / chatgpt.com run there) and the
// AI desktop apps. A STUN reply carries the public address the page then sees
// — sent direct it is the customer's mainland IP (third-party checkers flag
// it as 「CN 真实 IP 暴露」). Other programs' calls (meeting apps) stay as
// they are.
var webRTCProcesses = []string{
	"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe",
	"arc.exe", "thorium.exe", "chromium.exe", "360chrome.exe", "360se.exe", "qqbrowser.exe", "sogouexplorer.exe",
	"claude.exe", "chatgpt.exe",
}

// WebRTCProcesses lists them.
func WebRTCProcesses() []string { return append([]string(nil), webRTCProcesses...) }
