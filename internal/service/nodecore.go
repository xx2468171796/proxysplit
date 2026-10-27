package service

import (
	"errors"
	"fmt"
	"strings"

	"proxysplit/internal/nodes"
)

// NodeCoreChange describes a SetNodeCore call (for telemetry / the UI):
// From / To are the EFFECTIVE cores before and after.
type NodeCoreChange struct {
	NodeType  string
	Transport string
	From, To  string
}

// SetNodeCore stores the user's per-node core choice ("" / "auto" = 自动,
// "sing-box", "xray") and, when the effective core changed, restarts what
// carries the node: the main core (node active or used by a line) and the
// proxy ports exiting through it.
func (s *Service) SetNodeCore(id, choice string) (NodeCoreChange, error) {
	choice = strings.ToLower(strings.TrimSpace(choice))
	if choice == "auto" {
		choice = nodes.CoreAuto
	}
	s.mu.Lock()
	n := s.nodeByID(id)
	if n == nil {
		s.mu.Unlock()
		return NodeCoreChange{}, errors.New("节点不存在")
	}
	if err := n.ValidateCore(choice); err != nil {
		s.mu.Unlock()
		return NodeCoreChange{}, err
	}
	ch := NodeCoreChange{NodeType: n.Type, Transport: n.XrayNetwork(), From: n.EffectiveCore()}
	n.Core = choice
	ch.To = n.EffectiveCore()
	s.save()
	mainUses := s.mainUsesNodeLocked(id)
	ports := s.portsUsingNodeLocked(id)
	s.mu.Unlock()
	if ch.From == ch.To {
		return ch, nil
	}
	s.log(fmt.Sprintf("[service] 节点「%s」内核改为 %s", n.Name, ch.To))
	for _, pid := range ports {
		if err := s.startPort(pid); err != nil {
			s.log(fmt.Sprintf("[port] %s 换内核后重启失败：%v", pid, err))
		}
	}
	if mainUses {
		if err := s.applyLive(); err != nil {
			return ch, errors.New(restartMsg(err))
		}
	}
	return ch, nil
}

// mainUsesNodeLocked: the running main core carries node id (active node or
// an extra node of a line / app rule). Caller holds s.mu.
func (s *Service) mainUsesNodeLocked(id string) bool {
	if s.run == nil {
		return false
	}
	if s.run.node != nil && s.run.node.ID == id {
		return true
	}
	for _, en := range s.run.base.ExtraNodes {
		if en.Node != nil && en.Node.ID == id {
			return true
		}
	}
	return false
}

// portsUsingNodeLocked lists enabled proxy ports exiting through node id
// (pinned to it, or following the selected node). Caller holds s.mu.
func (s *Service) portsUsingNodeLocked(id string) []string {
	var out []string
	for _, p := range s.cfg.ProxyPorts {
		if !p.Enabled {
			continue
		}
		if n := s.portNodeLocked(p); n != nil && n.ID == id {
			out = append(out, p.ID)
		}
	}
	return out
}

// keepNodeCores carries the user's core choice over a subscription refresh:
// reconcileSubscriptionNodes already gave refreshed nodes their old IDs. A
// choice the refreshed node no longer allows (e.g. it became XHTTP) is
// dropped back to auto.
func keepNodeCores(oldNodes, freshNodes []*nodes.Node) {
	byID := make(map[string]*nodes.Node, len(oldNodes))
	for _, o := range oldNodes {
		if o != nil {
			byID[o.ID] = o
		}
	}
	for _, f := range freshNodes {
		o := byID[f.ID]
		if o == nil {
			continue
		}
		if o.Core != "" && f.ValidateCore(o.Core) == nil {
			f.Core = o.Core
		}
		f.Via = o.Via // the user's 前置代理 choice survives a refresh too
	}
}
