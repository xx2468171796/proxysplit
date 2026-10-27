// Package telemetry records every client operation and log line into a
// bounded on-disk spool and uploads it, sanitised and gzip-compressed, to the
// ProxySplit API so failures can be diagnosed from server data alone.
//
// The event catalog below is the wire standard shared with
// server/packages/contracts/src/telemetry.ts and docs/telemetry-events.md:
// add new types and bump SchemaVersion when the envelope changes; never
// repurpose an existing type or error code.
package telemetry

// SchemaVersion of the upload envelope. Bump on envelope changes only (new
// event types do not need a bump).
const SchemaVersion = 1

// Status of one event.
type Status string

const (
	OK   Status = "ok"
	Fail Status = "fail"
	Info Status = "info"
)

// Event types. One constant per type; the string is stored server-side and
// must never be reused for a different meaning.
const (
	AppStart        = "app.start"         // launch: OS, arch, admin, locale, channel
	AppExit         = "app.exit"          // clean shutdown
	AppCrash        = "app.crash"         // recovered panic + last log lines
	AppPageView     = "app.page_view"     // main screen opened
	AppUpdateCheck  = "app.update_check"  // manual / automatic update check
	AppUpdate       = "app.update"        // download + schedule install
	AppUpdateResult = "app.update_result" // first launch after an update

	ProxyStart   = "proxy.start"   // trigger, mode, capture, protocol, duration
	ProxyStop    = "proxy.stop"    // trigger
	ProxyRestart = "proxy.restart" // trigger, duration
	TunCreate    = "tun.create"    // TUN adapter outcome (from core log)
	CoreExit     = "core.exit"     // sing-box process exited
	CoreFatal    = "core.fatal"    // sing-box FATAL / panic line
	CoreUpdate   = "core.update"   // core download / switch
	NetBlocked   = "net.blocked"   // post-start check: traffic blocked

	NodeAdd        = "node.add"         // paste / manual import: protocols, counts
	NodeRemove     = "node.remove"      // protocol
	NodeSelect     = "node.select"      // protocol
	NodeLatency    = "node.latency"     // protocol, ms or timeout
	NodeTCP        = "node.tcp"         // protocol, ms or timeout
	NodeLatencyAll = "node.latency_all" // batch latency test
	NodeSpeed      = "node.speed"       // protocol, Mbps
	NodeCoreChange = "node.core"        // per-node core choice: nodeType, transport, from, to
	SubAdd         = "sub.add"          // subscription host, node count
	SubUpdate      = "sub.update"       // subscription refresh
	SubEdit        = "sub.edit"         // subscription edited
	SubRemove      = "sub.remove"       // subscription removed

	AppRuleChange   = "app_rule.change"   // apps added / removed per line
	CustomAppChange = "custom_app.change" // user-defined app catalog entries
	RuleChange      = "rule.change"       // custom domain / IP rules added / removed
	RuleSetChange   = "ruleset.change"    // bundled rule-set toggled
	LineChange      = "line.change"       // custom lines
	SettingsChange  = "settings.change"   // key, old -> new (sanitised)
	ModeChange      = "mode.change"       // rule mode / clash mode / default line / routing

	SelfTest   = "diag.self_test"  // self-test report
	RouteTest  = "diag.route_test" // per-app route test
	AIEnvCheck = "diag.ai_env"     // AI environment check
	AIEnvFix   = "diag.ai_env_fix" // AI environment fix item

	AccountLogin    = "account.login"    // method, outcome
	AccountLogout   = "account.logout"   //
	AccountRegister = "account.register" //
	AccountRedeem   = "account.redeem"   //
	License         = "account.license"  // membership state snapshot
	PowerVPNNodes   = "powervpn.nodes"   // POWER云 node fetch

	EnvSecurity = "env.security"  // security software detected
	EnvOtherVPN = "env.other_vpn" // other VPN / proxy adapters
	EnvDefender = "env.defender"  // Defender detection history
	ProxyPort   = "proxy_port.change"
)

// Normalised error codes. Raw error text is always kept next to the code.
const (
	ErrCoreStart      = "CORE_START_FAIL"
	ErrCoreExit       = "CORE_EXIT"
	ErrTunCreate      = "TUN_CREATE_FAIL"
	ErrBlockedAV      = "CORE_BLOCKED_AV"
	ErrDNS            = "DNS_FAIL"
	ErrNodeTimeout    = "NODE_TIMEOUT"
	ErrNodeAuth       = "NODE_AUTH_FAIL"
	ErrNodeUnreach    = "NODE_UNREACHABLE"
	ErrTLS            = "TLS_FAIL"
	ErrParse          = "PARSE_FAIL"
	ErrSubFetch       = "SUB_FETCH_FAIL"
	ErrNoNode         = "NO_NODE"
	ErrPortInUse      = "PORT_IN_USE"
	ErrPermission     = "PERMISSION_DENIED"
	ErrConfig         = "CONFIG_INVALID"
	ErrLicense        = "LICENSE_DENIED"
	ErrNetwork        = "NETWORK_FAIL"
	ErrUpdateDownload = "UPDATE_DOWNLOAD_FAIL"
	ErrUpdateVerify   = "UPDATE_VERIFY_FAIL"
	ErrPanic          = "PANIC"
	ErrUnknown        = "UNKNOWN"
)

// Event is the common envelope of every record (JSON names match the Zod
// contract).
type Event struct {
	EventID    string         `json:"eventId"`
	SessionID  string         `json:"sessionId"`
	Seq        int64          `json:"seq"`
	TS         string         `json:"ts"` // RFC3339Nano, UTC
	Type       string         `json:"type"`
	Status     Status         `json:"status"`
	DurationMs *int64         `json:"durationMs,omitempty"`
	ErrorCode  string         `json:"errorCode,omitempty"`
	ErrorText  string         `json:"errorText,omitempty"`
	Payload    map[string]any `json:"payload"`
}
