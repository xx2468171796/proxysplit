package service

import (
	"time"

	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
)

// AddNodes parses share links from text and appends new (non-duplicate) nodes.
func (s *Service) AddNodes(text string) (added, skipped int) {
	parsed, skip := nodes.ParseMany(text)
	parsed = s.officializePasted(parsed) // POWER云 links → official nodes (network; no lock held)
	s.mu.Lock()
	added = s.mergeNodesLocked(parsed, "")
	if s.cfg.SelectedID == "" && len(s.cfg.Nodes) > 0 {
		s.cfg.SelectedID = s.cfg.Nodes[0].ID
	}
	s.save()
	s.mu.Unlock()
	return added, skip
}

// mergeNodesLocked appends non-duplicate nodes, tagging them with subID.
func (s *Service) mergeNodesLocked(list []*nodes.Node, subID string) int {
	existing := map[string]bool{}
	for _, n := range s.cfg.Nodes {
		existing[n.ID] = true
	}
	added := 0
	for _, n := range list {
		if existing[n.ID] {
			continue
		}
		n.SubID = subID
		s.cfg.Nodes = append(s.cfg.Nodes, n)
		existing[n.ID] = true
		added++
	}
	return added
}

// AddManualNode adds a node from hand-entered fields (socks/http/etc.). Returns
// "" on success or an error string.
func (s *Service) AddManualNode(nodeType, name, server string, port int, username, password string) string {
	n, err := nodes.Manual(nodeType, name, server, port, username, password)
	if err != nil {
		return err.Error()
	}
	s.mu.Lock()
	added := s.mergeNodesLocked([]*nodes.Node{n}, "")
	if s.cfg.SelectedID == "" && len(s.cfg.Nodes) > 0 {
		s.cfg.SelectedID = s.cfg.Nodes[0].ID
	}
	s.save()
	s.mu.Unlock()
	if added == 0 {
		return "节点已存在"
	}
	return ""
}

// Nodes returns deep copies of the configured nodes. Copies (not the live
// pointers) are handed to the UI so the Wails marshaler never reads a Node struct
// while a latency test is writing to it.
func (s *Service) Nodes() []*nodes.Node {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*nodes.Node, 0, len(s.cfg.Nodes))
	for _, n := range s.cfg.Nodes {
		c := *n
		c.CoreInfo = c.DescribeCore()
		out = append(out, &c)
	}
	return out
}

// RemoveNode deletes a node by id.
func (s *Service) RemoveNode(id string) string { return s.RemoveNodes([]string{id}) }

// RemoveNodes deletes several nodes with one save and one core restart
// (deleting one by one restarted the core per node).
func (s *Service) RemoveNodes(ids []string) string {
	drop := make(map[string]bool, len(ids))
	for _, id := range ids {
		drop[id] = true
	}
	s.mu.Lock()
	kept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if !drop[n.ID] {
			kept = append(kept, n)
		}
	}
	s.cfg.Nodes = kept
	s.healDanglingNodeRefsLocked()
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive())
}

// SelectNode sets the active node (and restarts if a running line follows it).
func (s *Service) SelectNode(id string) string {
	s.mu.Lock()
	s.cfg.SelectedID = id
	s.save()
	s.mu.Unlock()
	go s.restartPortsFollowingActive()
	return restartMsg(s.applyLive())
}

// selectedNode is the active node; for AutoNodeID the synthetic urltest node.
func (s *Service) selectedNode() *nodes.Node {
	if s.cfg.SelectedID == AutoNodeID {
		return s.autoNodeLocked()
	}
	for _, n := range s.cfg.Nodes {
		if n.ID == s.cfg.SelectedID {
			return n
		}
	}
	return nil
}

func (s *Service) nodeByID(id string) *nodes.Node {
	for _, n := range s.cfg.Nodes {
		if n.ID == id {
			return n
		}
	}
	return nil
}

// TestLatency measures one node and stores the result. measureNode starts an
// isolated core when necessary, then requires a real Google HTTPS 204 response
// through the complete protocol tunnel.
func (s *Service) TestLatency(id string) int {
	s.mu.Lock()
	n := s.nodeByID(id)
	var snap nodes.Node
	if n != nil {
		snap = *n
	}
	s.mu.Unlock()
	if n == nil {
		return -1
	}
	res := s.measureNode(&snap, 8*time.Second)
	s.mu.Lock()
	if current := s.nodeByID(id); current != nil {
		current.Latency = res.Latency
		current.TCPLatency = res.TCPLatency
		if res.Speed > 0 {
			current.Speed = res.Speed
		}
		s.save()
	}
	s.mu.Unlock()
	return res.Latency
}

// TestTCP measures ONLY the raw TCP latency to a node's edge (direct dial +
// protocol handshake, no proxy tunnel). It is fast and needs no core, so it is
// the cheap "is the line reachable at all" check, distinct from TestLatency's
// full Google end-to-end probe. Returns ms, -1 on failure.
func (s *Service) TestTCP(id string) int {
	s.mu.Lock()
	n := s.nodeByID(id)
	var snap nodes.Node
	if n != nil {
		snap = *n
	}
	s.mu.Unlock()
	if n == nil {
		return -1
	}
	res := latency.Measure(s.pinned(&snap), "", 6*time.Second)
	s.mu.Lock()
	if current := s.nodeByID(id); current != nil {
		current.TCPLatency = res.TCPLatency
		s.save()
	}
	s.mu.Unlock()
	return res.TCPLatency
}

// TestAllLatency measures every node.
func (s *Service) TestAllLatency() {
	s.mu.Lock()
	snaps := make([]nodes.Node, 0, len(s.cfg.Nodes))
	for _, n := range s.cfg.Nodes {
		if n != nil {
			snaps = append(snaps, *n)
		}
	}
	s.mu.Unlock()

	results := make([]latency.Result, len(snaps))
	forEachBounded(len(snaps), latencyConcurrency, func(i int) {
		results[i] = latency.Result{Latency: -1, TCPLatency: -1} // kept if measureNode panics
		results[i] = s.measureNode(&snaps[i], 8*time.Second)
	})
	s.mu.Lock()
	for i, r := range results {
		if n := s.nodeByID(snaps[i].ID); n != nil {
			n.Latency = r.Latency
			n.TCPLatency = r.TCPLatency
		}
	}
	s.save()
	s.mu.Unlock()
}
