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
	var snap *nodes.Node
	if node != nil {
		copy := *node
		snap = &copy
	}
	s.mu.Unlock()

	if snap == nil {
		return 0, fmt.Errorf("没有可测速的活动节点")
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
