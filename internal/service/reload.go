package service

import "fmt"

// applyLive makes a saved change (nodes, subscriptions, lines, rules) take
// effect on the running core. The new config is generated first: when it is
// byte-identical to the running one nothing is restarted (a scheduled
// subscription refresh that changed nothing used to reset every connection);
// otherwise it is validated and only then swapped in. No-op when stopped.
func (s *Service) applyLive() error {
	err := s.reload(false)
	if err != nil {
		s.log("[service] reload after rule change failed: " + err.Error())
	}
	return err
}

// restart always replaces a running core (changed binary, rule files, network
// reset), still validating the new config before the old core is stopped.
// No-op when stopped.
func (s *Service) restart() error { return s.reload(true) }

// reload runs under one lifecycle lock, so a Stop from the user cannot slip in
// between and be undone by the Start, and concurrent changes go one after the
// other.
func (s *Service) reload(force bool) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if !s.core.Running() {
		return nil
	}
	if _, err := s.pickNode(); err != nil {
		s.stopLocked() // nothing left to run (the last node was deleted)
		return err
	}
	plan, err := s.planStart(s.liveReuse())
	if err != nil {
		s.stopLocked()
		return err
	}
	return reloadSteps(force, reloadOps{
		unchanged: func() bool { return s.applyUnchanged(plan) },
		check:     func() error { return s.core.CheckTUN(plan.node, plan.level, plan.route, plan.opts) },
		swap:      s.swapCoreLocked,
	})
}

// reloadOps are the three steps of a reload (tests fake them).
type reloadOps struct {
	unchanged func() bool  // the running core already runs the new config
	check     func() error // validate the new config; the old core keeps running
	swap      func() error // stop the old core, start the new one
}

// reloadSteps is the reload rule: never restart for an identical config, and
// never stop a working core for a config that does not validate.
func reloadSteps(force bool, ops reloadOps) error {
	if !force && ops.unchanged() {
		return nil
	}
	if err := ops.check(); err != nil {
		return fmt.Errorf("新配置没有通过内核校验，代理仍按原来的配置运行：%w", err)
	}
	return ops.swap()
}

// liveReuse returns the running core's per-run values for planStart.
func (s *Service) liveReuse() *planReuse {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := &planReuse{clashPort: s.clashPort, clashSecret: s.clashSecret, serverIPs: s.liveIPs}
	if s.run != nil {
		r.procPorts = s.run.procPorts
	}
	return r
}

// applyUnchanged reports whether the running core already runs p's config. In
// 应用分流 the app lists live outside the config: they are brought up to date
// here (rule-set files, capture routes), as a hot app-rule change does.
func (s *Service) applyUnchanged(p *startPlan) bool {
	if !p.split {
		same, err := s.core.RunningConfigIs(p.node, p.level, p.route, p.opts)
		return err == nil && same
	}
	same, err := s.core.ApplySplitLists(p.node, p.level, p.route, nil, p.opts)
	if err != nil || !same {
		return false
	}
	s.finishHotApply(p.opts, p.sum.targets)
	return true
}

// swapCoreLocked replaces the running core. The capture engine stays, holding
// the selected programs (refused, not direct) until the new core is up; if
// that fails the proxy ends stopped with the reason. Caller holds lifecycleMu.
func (s *Service) swapCoreLocked() error {
	s.mu.Lock()
	s.health.phase = RunRestarting // an exit while the new core starts is ours, not a crash
	eng := s.capEng
	s.mu.Unlock()
	if eng != nil {
		eng.SetHold(true)
	}
	s.stopCoreLocked()
	err := s.startLocked()
	if err != nil {
		s.failRun(EventCoreFailed, "重新加载配置后内核没有启动成功，代理已停止："+err.Error())
	}
	return err
}
