package engine

// Special targets. Any other target string is an upstream key naming a line's
// SOCKS dialer (see core.LineConfig.Key).
const (
	TargetDirect = "direct" // leave untouched
	TargetBlock  = "block"  // drop the connection
)

// Rule matches a process by executable and assigns a target (a line's upstream
// key, or TargetDirect / TargetBlock).
type Rule struct {
	Match   string `json:"match"`  // exe base name or full path
	Path    string `json:"path"`   // full path (display)
	Target  string `json:"target"` // upstream key | direct | block
	Enabled bool   `json:"enabled"`
}

// Rule modes control what happens to processes NOT in the list.
const (
	ModeBlacklist = "blacklist" // unlisted -> direct (only listed apps are routed)
	ModeWhitelist = "whitelist" // unlisted -> defaultTarget (only listed are exceptions)
)
