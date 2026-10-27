package service

import "proxysplit/internal/nodes"

// AutoNodeID is the SelectedID of "自动选择（最快）": the main proxy outbound
// becomes a sing-box urltest group over the eligible stored nodes.
const AutoNodeID = "auto"

// AutoNodeName is how the synthetic node is shown.
const AutoNodeName = "自动选择（最快）"

// autoEligible: official POWER云 lines carry egress restrictions keyed by
// their own outbound tag (they cannot be mixed into a group); verbatim groups
// and Xray nodes are left out to keep the group plain sing-box.
func autoEligible(n *nodes.Node) bool {
	return n != nil && !n.Official && !n.HasRaw() && !n.UseXray() && !isPlaceholderEndpoint(n.Server)
}

// autoNodeLocked builds the synthetic urltest node; members are chained
// copies (前置代理 still applies). No member = the core reports
// "没有可自动选择的节点" on start. Caller holds s.mu.
func (s *Service) autoNodeLocked() *nodes.Node {
	n := &nodes.Node{ID: AutoNodeID, Name: AutoNodeName, Type: nodes.TypeURLTest}
	for _, m := range s.cfg.Nodes {
		if autoEligible(m) {
			n.Members = append(n.Members, s.chainLocked(m))
		}
	}
	return n
}

// expandNodes lists each node plus its group members and front nodes, for
// server pre-resolution and keep-warm.
func expandNodes(list []*nodes.Node) []*nodes.Node {
	var out []*nodes.Node
	for _, n := range list {
		if n == nil {
			continue
		}
		out = append(out, n)
		if n.ViaNode != nil {
			out = append(out, n.ViaNode)
		}
		out = append(out, expandNodes(n.Members)...)
	}
	return out
}
