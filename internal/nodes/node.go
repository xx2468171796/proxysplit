package nodes

import "encoding/json"

// Node is a protocol-agnostic description of a single proxy server (a "节点").
// It carries enough information to generate a sing-box outbound of the matching
// type. Fields that do not apply to a given protocol are left zero.
type Node struct {
	ID   string `json:"id"`   // stable identifier (derived from the link)
	Name string `json:"name"` // display remark
	Type string `json:"type"` // vless | vmess | trojan | shadowsocks

	Server string `json:"server"`
	Port   int    `json:"port"`

	// Credentials
	UUID     string `json:"uuid,omitempty"`     // vless / vmess / tuic
	Password string `json:"password,omitempty"` // trojan / ss / hysteria2 / tuic / socks / http
	Username string `json:"username,omitempty"` // socks / http
	Method   string `json:"method,omitempty"`   // shadowsocks cipher
	AlterID  int    `json:"alterId,omitempty"`  // vmess
	Cipher   string `json:"cipher,omitempty"`   // vmess security (auto/none/...)
	CC       string `json:"cc,omitempty"`       // tuic congestion control

	// TLS / security
	Security    string   `json:"security,omitempty"` // tls | reality | none
	SNI         string   `json:"sni,omitempty"`
	ALPN        []string `json:"alpn,omitempty"`
	Fingerprint string   `json:"fingerprint,omitempty"` // uTLS fingerprint (chrome, ...)
	Flow        string   `json:"flow,omitempty"`        // vless flow (xtls-rprx-vision)
	PublicKey   string   `json:"publicKey,omitempty"`   // reality public key
	ShortID     string   `json:"shortId,omitempty"`     // reality short id
	Insecure    bool     `json:"insecure,omitempty"`

	// Transport
	Network string `json:"network,omitempty"` // tcp | ws | grpc | http
	Path    string `json:"path,omitempty"`    // ws/http path or grpc serviceName
	Host    string `json:"host,omitempty"`    // ws/http Host header

	// Compat extras (third-party subscriptions). Multiplex is a sing-box
	// "multiplex" object (from Clash smux / brutal-opts); Plugin/PluginOpts are
	// the shadowsocks SIP003 plugin in sing-box form (obfs-local / v2ray-plugin).
	Multiplex  map[string]any `json:"multiplex,omitempty"`
	Plugin     string         `json:"plugin,omitempty"`
	PluginOpts string         `json:"pluginOpts,omitempty"`

	// Raw sing-box outbounds. When set, the config builder uses them verbatim
	// (only tags are prefixed to avoid collisions) instead of synthesizing an
	// outbound from the fields above. EntryTag names the outbound the user
	// selects (e.g. a urltest group whose members are also in Outbounds).
	// Official marks nodes delivered by a signed POWER云 profile.
	Official  bool   `json:"official,omitempty"`
	AccountID string `json:"accountId,omitempty"` // POWER云 proxy account id
	// OfficialKey is the stable identity of an official node ("<account id>/<panel
	// node key>", e.g. ".../relay:<node id>"); empty when the panel sent no key.
	// Tags carry list positions ("节点 2 · 台湾"), so a refresh matches nodes by
	// this key to keep their ID (and the user's selection) across reorders.
	OfficialKey string            `json:"officialKey,omitempty"`
	Outbounds   []json.RawMessage `json:"outbounds,omitempty"`
	EntryTag    string            `json:"entryTag,omitempty"`

	// Runtime measurements (populated by latency/speed tests).
	// Latency: Google end-to-end latency through the full proxy tunnel.
	// TCPLatency: raw TCP connect latency to Server:Port (transport reachability).
	// Both: 0 = not measured, -1 = unreachable, positive = milliseconds.
	Latency    int     `json:"latency"`         // Google 延迟 ms
	TCPLatency int     `json:"tcpLatency"`      // TCP 延迟 ms
	Speed      float64 `json:"speed"`           // MB/s
	SubID      string  `json:"subId,omitempty"` // owning subscription, if any

	Raw string `json:"raw,omitempty"` // original share link
}
