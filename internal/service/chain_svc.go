package service

import (
	"fmt"

	"proxysplit/internal/nodes"
)

// chainLocked returns n with its front node (前置代理, n.Via) resolved onto a
// copy, ready for the core; n itself when it has none or the front is gone.
// Caller holds s.mu.
func (s *Service) chainLocked(n *nodes.Node) *nodes.Node {
	// A node that became unchainable (switched to Xray, or a refresh made it
	// Xray-only) keeps Via stored but dials directly, so the core still starts.
	if n == nil || n.Via == "" || n.Via == n.ID || n.UseXray() || n.HasRaw() {
		return n
	}
	front := s.nodeByID(n.Via)
	if front == nil {
		return n
	}
	c, f := *n, *front
	f.ViaNode, f.Via = nil, "" // one hop only
	c.ViaNode = &f
	return &c
}

// SetNodeVia sets (viaID "" clears) the node a node is dialled through. The
// front must be another existing, non-official node without a front of its
// own; the core restarts so the chain applies at once.
func (s *Service) SetNodeVia(id, viaID string) string {
	s.mu.Lock()
	n := s.nodeByID(id)
	if n == nil {
		s.mu.Unlock()
		return "节点不存在"
	}
	if viaID != "" {
		front := s.nodeByID(viaID)
		switch {
		case viaID == id:
			s.mu.Unlock()
			return "不能把节点自己设为前置"
		case front == nil:
			s.mu.Unlock()
			return "前置节点不存在"
		case front.Official:
			s.mu.Unlock()
			return "POWER云 官方线路不能用作前置代理"
		case front.Via != "":
			s.mu.Unlock()
			return fmt.Sprintf("「%s」自己也设了前置，只支持一层前置", front.Name)
		case n.Official:
			s.mu.Unlock()
			return "POWER云 官方线路不能再设前置代理"
		case s.isFrontLocked(id):
			s.mu.Unlock()
			return fmt.Sprintf("「%s」已是别的节点的前置，只支持一层前置", n.Name)
		case n.UseXray() || n.HasRaw():
			s.mu.Unlock()
			return fmt.Sprintf("「%s」暂不支持前置代理（Xray 节点或整组导入的配置）", n.Name)
		}
	}
	n.Via = viaID
	s.save()
	s.mu.Unlock()
	return restartMsg(s.restart())
}

// isFrontLocked: some node is dialled through id. Caller holds s.mu.
func (s *Service) isFrontLocked(id string) bool {
	for _, n := range s.cfg.Nodes {
		if n != nil && n.Via == id {
			return true
		}
	}
	return false
}
