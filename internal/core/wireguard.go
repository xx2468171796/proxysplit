package core

import (
	"encoding/json"

	"proxysplit/internal/nodes"
)

// buildWireGuard is a sing-box 1.14 WireGuard endpoint. It is built in the
// outbound list like any node; marshalConfig moves it to "endpoints" (sing-box
// removed the wireguard outbound), where route rules / detour still find it
// by tag.
func buildWireGuard(n *nodes.Node, tag string) M {
	peer := M{"address": n.Server, "port": n.Port, "public_key": n.PublicKey,
		"allowed_ips": []string{"0.0.0.0/0", "::/0"}, "persistent_keepalive_interval": 25}
	if n.WGPreShared != "" {
		peer["pre_shared_key"] = n.WGPreShared
	}
	if len(n.WGReserved) == 3 {
		peer["reserved"] = n.WGReserved
	}
	mtu := n.WGMTU
	if mtu <= 0 {
		mtu = 1408
	}
	return M{"type": "wireguard", "tag": tag, "system": false, "mtu": mtu,
		"address": n.WGAddress, "private_key": n.Password, "peers": []M{peer}}
}

// marshalConfig serialises a config, first moving WireGuard entries from
// "outbounds" to "endpoints". Configs without them are unchanged byte for byte.
func marshalConfig(cfg M) ([]byte, error) {
	if outs, ok := cfg["outbounds"].([]M); ok {
		var keep, eps []M
		for _, o := range outs {
			if o["type"] == "wireguard" {
				eps = append(eps, o)
			} else {
				keep = append(keep, o)
			}
		}
		if len(eps) > 0 {
			cfg["outbounds"], cfg["endpoints"] = keep, eps
		}
	}
	return json.MarshalIndent(cfg, "", "  ")
}
