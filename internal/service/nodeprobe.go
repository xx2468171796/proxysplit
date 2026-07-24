package service

import (
	"fmt"
	"path/filepath"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
)

// measureNode performs a full protocol test. The already-running main core is
// reused only when it is actually serving the requested node; every other node
// gets an isolated temporary core.
func (s *Service) measureNode(node *nodes.Node, timeout time.Duration) latency.Result {
	if node == nil {
		return latency.Result{Latency: -1}
	}

	s.mu.Lock()
	selectedID := s.cfg.SelectedID
	binPath := filepath.Join(s.binDir, "sing-box.exe")
	probeDir := filepath.Join(s.dataDir, "probes")
	s.mu.Unlock()

	if node.ID == selectedID && s.core.Running() {
		if port := s.core.Port(); port > 0 {
			return latency.Measure(node, fmt.Sprintf("127.0.0.1:%d", port), timeout)
		}
	}

	probe, err := core.StartProbe(binPath, probeDir, node, 4*time.Second)
	if err != nil {
		s.log(fmt.Sprintf("[latency] %s: %v", node.Name, err))
		return latency.Result{Latency: -1}
	}
	defer probe.Close()
	return latency.Measure(node, probe.Addr(), timeout)
}

// nodeSocks returns a full-protocol test tunnel for node. closeFn is always
// safe to call; for the running main core it is a no-op.
func (s *Service) nodeSocks(node *nodes.Node) (addr string, closeFn func(), err error) {
	if node == nil {
		return "", func() {}, fmt.Errorf("没有可测速的活动节点")
	}

	s.mu.Lock()
	selectedID := s.cfg.SelectedID
	binPath := filepath.Join(s.binDir, "sing-box.exe")
	probeDir := filepath.Join(s.dataDir, "probes")
	s.mu.Unlock()

	if node.ID == selectedID && s.core.Running() {
		if port := s.core.Port(); port > 0 {
			return fmt.Sprintf("127.0.0.1:%d", port), func() {}, nil
		}
	}
	probe, err := core.StartProbe(binPath, probeDir, node, 4*time.Second)
	if err != nil {
		return "", func() {}, err
	}
	return probe.Addr(), func() { _ = probe.Close() }, nil
}
