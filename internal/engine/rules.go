package engine

import (
	"net/netip"
	"strings"
	"sync"

	"proxysplit/internal/proc"
)

// Special targets. Any other target string is an upstream key naming a line's
// SOCKS dialer (see Engine.SetUpstreams).
const (
	TargetDirect = "direct" // leave untouched
	TargetBlock  = "block"  // drop the connection
)

// Rule matches a process by executable and assigns a target (a line's upstream
// key, or TargetDirect / TargetBlock).
type Rule struct {
	Match   string `json:"match"`   // exe base name or full path
	Path    string `json:"path"`    // full path (display)
	Target  string `json:"target"`  // upstream key | direct | block
	Enabled bool   `json:"enabled"`
}

// Rule modes control what happens to processes NOT in the list.
const (
	ModeBlacklist = "blacklist" // unlisted -> direct (only listed apps are routed)
	ModeWhitelist = "whitelist" // unlisted -> defaultTarget (only listed are exceptions)
)

// Matcher decides the target for a connection based on the rule set, the rule
// mode, a default target for unlisted apps (whitelist), and always-excluded PIDs.
type Matcher struct {
	mu            sync.RWMutex
	byName        map[string]string // base name -> target
	byPath        map[string]string // full path -> target
	mode          string
	defaultTarget string // for unlisted apps in whitelist mode
	exclude       map[uint32]bool
	excludeExe    map[string]bool
	privateDirect bool
}

// NewMatcher returns an empty matcher in blacklist mode.
func NewMatcher() *Matcher {
	return &Matcher{
		byName:        map[string]string{},
		byPath:        map[string]string{},
		mode:          ModeBlacklist,
		defaultTarget: TargetDirect,
		exclude:       map[uint32]bool{},
		excludeExe:    map[string]bool{},
	}
}

// SetRules replaces the rule set, mode, and the default target for unlisted apps.
func (m *Matcher) SetRules(rules []Rule, mode, defaultTarget string) {
	bn := map[string]string{}
	bp := map[string]string{}
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(r.Match))
		if key == "" || r.Target == "" {
			continue
		}
		if strings.ContainsAny(key, "\\/") {
			bp[strings.ReplaceAll(key, "/", "\\")] = r.Target
			// Also index by base name so the rule still matches if the runtime
			// image path differs at all from the stored one (8.3 names, casing,
			// symlinks, WOW64 redirection). Precise byPath still wins at lookup.
			if base := proc.BaseName(key); base != "" {
				if _, exists := bn[base]; !exists {
					bn[base] = r.Target
				}
			}
		} else {
			bn[key] = r.Target
		}
	}
	if mode != ModeWhitelist {
		mode = ModeBlacklist
	}
	if defaultTarget == "" {
		defaultTarget = TargetDirect
	}
	m.mu.Lock()
	m.byName, m.byPath, m.mode, m.defaultTarget = bn, bp, mode, defaultTarget
	m.mu.Unlock()
}

// SetPrivateDirect toggles keeping LAN/private-IP connections direct.
func (m *Matcher) SetPrivateDirect(v bool) {
	m.mu.Lock()
	m.privateDirect = v
	m.mu.Unlock()
}

// ExcludePID marks a PID as never-routed (our process and the core).
func (m *Matcher) ExcludePID(pid uint32) {
	m.mu.Lock()
	m.exclude[pid] = true
	m.mu.Unlock()
}

// ExcludeExe marks an executable base name as never-routed (robust against the
// core process being restarted with a new PID).
func (m *Matcher) ExcludeExe(name string) {
	m.mu.Lock()
	m.excludeExe[strings.ToLower(name)] = true
	m.mu.Unlock()
}

func (m *Matcher) lookup(exePath string) (string, bool) {
	if len(m.byPath) > 0 {
		if t, ok := m.byPath[strings.ToLower(exePath)]; ok {
			return t, true
		}
	}
	if t, ok := m.byName[proc.BaseName(exePath)]; ok {
		return t, true
	}
	return "", false
}

// Decide returns the target for a connection owned by pid/exe going to dst:
// TargetDirect, TargetBlock, or an upstream key.
func (m *Matcher) Decide(pid uint32, exePath string, dst netip.Addr) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.exclude[pid] || m.excludeExe[proc.BaseName(exePath)] {
		return TargetDirect
	}
	if m.privateDirect && isPrivate(dst) {
		return TargetDirect
	}
	if t, ok := m.lookup(exePath); ok {
		return t
	}
	if m.mode == ModeWhitelist {
		return m.defaultTarget
	}
	return TargetDirect
}

// isPrivate reports RFC1918 / loopback / link-local / CGNAT addresses.
func isPrivate(ip netip.Addr) bool {
	if !ip.IsValid() {
		return false
	}
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() ||
		(ip.Is4() && ip.As4()[0] == 100 && ip.As4()[1]&0xc0 == 64) // 100.64.0.0/10
}
