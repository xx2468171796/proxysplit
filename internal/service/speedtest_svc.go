package service

import (
	"fmt"
	"time"

	"proxysplit/internal/latency"
)

// SpeedTest measures download throughput (MB/s) for the currently selected node
// through the running core's SOCKS inbound, records it on the node, and returns
// the result. It fails when the proxy is not running or is in TUN mode.
func (s *Service) SpeedTest() (float64, error) {
	s.mu.Lock()
	running := s.core.Running()
	port := s.core.Port()
	node := s.selectedNode()
	s.mu.Unlock()

	if !running || port == 0 {
		return 0, fmt.Errorf("代理未运行(或处于 TUN 模式),无法测速")
	}

	socks := fmt.Sprintf("127.0.0.1:%d", port)
	mbps, err := latency.SpeedTest(socks, 12*time.Second)
	if err != nil {
		return 0, err
	}

	if node != nil {
		s.mu.Lock()
		node.Speed = mbps
		s.save()
		s.mu.Unlock()
	}

	s.log(fmt.Sprintf("[speed] %.2f MB/s", mbps))
	return mbps, nil
}
