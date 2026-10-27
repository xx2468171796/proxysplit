package nodes

import "fmt"

// Core choices for Node.Core ("" = automatic).
const (
	CoreAuto    = ""
	CoreSingBox = "sing-box"
	CoreXray    = "xray"
)

// XraySupports reports whether the Xray sidecar can carry this node:
// vless / vmess / trojan / shadowsocks (without a SIP003 plugin) / socks /
// http over a transport the Xray outbound builder knows. Raw sing-box
// outbounds (POWER云 / imported configs) never can.
func (n *Node) XraySupports() bool {
	if n == nil || n.HasRaw() {
		return false
	}
	switch n.Type {
	case "vless", "vmess", "trojan":
	case "shadowsocks":
		return n.Plugin == "" && n.Method != ""
	case "socks", "http":
		return true
	default:
		return false
	}
	switch n.XrayNetwork() {
	case NetXHTTP, NetKCP, "ws", "grpc", "raw":
		return true
	}
	return false
}

// EffectiveCore is the core that actually carries the node: "xray" when the
// node can only run on Xray (NeedsXray) or the user forced Xray and Xray
// supports it; otherwise "sing-box".
func (n *Node) EffectiveCore() string {
	if n.UseXray() {
		return CoreXray
	}
	return CoreSingBox
}

// UseXray reports whether the node is served by the Xray sidecar. Every place
// that decides between the cores (main core, extra / line nodes, port
// proxies, probes) goes through this.
func (n *Node) UseXray() bool {
	if n == nil {
		return false
	}
	if n.NeedsXray() {
		return true
	}
	return n.Core == CoreXray && n.XraySupports()
}

// CoreInfo tells the UI which core carries a node and which choices it allows.
type CoreInfo struct {
	Effective     string `json:"effective"`     // "sing-box" | "xray"
	XrayOnly      bool   `json:"xrayOnly"`      // NeedsXray: sing-box not allowed
	XraySupported bool   `json:"xraySupported"` // XraySupports: xray allowed
}

// DescribeCore builds the node's CoreInfo.
func (n *Node) DescribeCore() *CoreInfo {
	return &CoreInfo{Effective: n.EffectiveCore(), XrayOnly: n.NeedsXray(), XraySupported: n.XraySupports()}
}

// ValidateCore checks a user's core choice for this node; the error text is
// shown in the UI.
func (n *Node) ValidateCore(core string) error {
	switch core {
	case CoreAuto:
		return nil
	case CoreSingBox:
		if n.NeedsXray() {
			return fmt.Errorf("该节点只能用 Xray 内核（XHTTP / mKCP / VLESS encryption）")
		}
		return nil
	case CoreXray:
		if !n.XraySupports() {
			return fmt.Errorf("Xray 不支持该节点的协议或传输方式")
		}
		return nil
	default:
		return fmt.Errorf("未知内核「%s」，可选：自动 / sing-box / xray", core)
	}
}
