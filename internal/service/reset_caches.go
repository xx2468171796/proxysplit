package service

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"

	"proxysplit/internal/dnswarm"
)

// liveWarm is the running DNS-prewarm store, so 清除与重置 can empty it in
// memory too (otherwise the loop would save the old list back on stop).
var liveWarm atomic.Pointer[dnswarm.Store]

// registerCacheResetters plugs the node-resolve cache and the DNS prewarm list
// into the reset center (the IDs reserved in reset.go).
func (s *Service) registerCacheResetters() {
	RegisterResetter(ResetNodeResolveCache, func(context.Context) error {
		s.nodeResolver().Clear()
		s.log("[reset] 节点域名解析缓存已清空，下次连接节点时重新解析")
		return nil
	})
	RegisterResetter(ResetDNSPrewarm, func(context.Context) error {
		if st := liveWarm.Load(); st != nil {
			return st.Clear()
		}
		if err := os.Remove(filepath.Join(s.dataDir, dnsWarmFile)); err != nil && !os.IsNotExist(err) {
			return err
		}
		s.log("[reset] DNS 预热名单已清空")
		return nil
	})
}

// dropDNSCacheFile removes the core's persistent DNS cache (only used while
// the core is stopped; a running core keeps the file open).
func (s *Service) dropDNSCacheFile() error {
	if err := os.Remove(filepath.Join(s.dataDir, dnsCacheFile)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// restartDroppingDNSCache is restart() with the persistent DNS cache removed
// while the core is down; a stopped core just loses the file.
func (s *Service) restartDroppingDNSCache() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if !s.core.Running() {
		return s.dropDNSCacheFile()
	}
	s.stopLocked()
	dropErr := s.dropDNSCacheFile()
	if err := s.startLocked(); err != nil {
		return err
	}
	return dropErr
}

func (s *Service) hasDNSCacheFile() bool {
	_, err := os.Stat(filepath.Join(s.dataDir, dnsCacheFile))
	return err == nil
}
