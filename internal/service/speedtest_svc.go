package service

import (
	"fmt"
	"time"

	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
)

// SpeedTest measures the selected node through a full proxy tunnel. When the
// main core cannot be reused it creates a short-lived isolated probe core, so
// speed testing also works while the proxy is stopped or running in TUN mode.
func (s *Service) SpeedTest() (float64, error) {
	s.mu.Lock()
	node := s.selectedNode()
	var id string
	if node != nil {
		id = node.ID
	}
	s.mu.Unlock()
	if id == "" {
		return 0, fmt.Errorf("没有可测速的活动节点")
	}
	if id == AutoNodeID {
		// The group is not a stored node: measure it through the running core
		// (or a probe of the same group); nothing is saved.
		socks, closeFn, err := s.nodeSocks(node)
		if err != nil {
			return 0, fmt.Errorf("启动节点测速失败: %w", err)
		}
		defer closeFn()
		return latency.SpeedTest(socks, 12*time.Second)
	}
	return s.SpeedTestNode(id)
}

// SpeedTestNode measures a specific node's download throughput (MB/s) through a
// full proxy tunnel, so any node in the list can be speed-tested individually
// without first setting it active.
func (s *Service) SpeedTestNode(id string) (float64, error) {
	s.mu.Lock()
	node := s.nodeByID(id)
	var snap *nodes.Node
	if node != nil {
		copy := *node
		snap = &copy
	}
	s.mu.Unlock()

	if snap == nil {
		return 0, fmt.Errorf("找不到该节点")
	}

	socks, closeFn, err := s.nodeSocks(snap)
	if err != nil {
		return 0, fmt.Errorf("启动节点测速失败: %w", err)
	}
	defer closeFn()
	mbps, err := latency.SpeedTest(socks, 12*time.Second)
	if err != nil {
		return 0, err
	}

	s.mu.Lock()
	if current := s.nodeByID(snap.ID); current != nil {
		current.Speed = mbps
		s.save()
	}
	s.mu.Unlock()

	s.log(fmt.Sprintf("[speed] %s %.2f MB/s", snap.Name, mbps))
	return mbps, nil
}
