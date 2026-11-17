package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
)

// A followed core installed while the proxy was stopped is "pending" until its
// first start (coreupdate.MarkPending, set by the follow round): the previous
// core is kept, and startLocked settles it — confirmPendingCore after a start
// that worked, rollbackPendingCore after one that did not.

// coreHoldFile remembers the version that failed to start across app restarts.
const coreHoldFile = "core-hold.json"

type coreHold struct {
	Version string    `json:"version"`
	At      time.Time `json:"at"`
}

func (s *Service) saveCoreHold(version string, at time.Time) {
	data, _ := json.Marshal(coreHold{Version: version, At: at})
	_ = os.WriteFile(filepath.Join(s.dataDir, coreHoldFile), data, 0o600)
}

func (s *Service) loadCoreHold() (string, time.Time) {
	var h coreHold
	if data, err := os.ReadFile(filepath.Join(s.dataDir, coreHoldFile)); err == nil {
		_ = json.Unmarshal(data, &h)
	}
	return h.Version, h.At
}

// confirmPendingCore runs after a successful start: a pending core has now
// proven itself, its backup can go.
func (s *Service) confirmPendingCore() {
	v := coreupdate.PendingVersion(s.binDir)
	if v == "" {
		return
	}
	coreupdate.ClearPending(s.binDir)
	_ = coreupdate.ClearBackup(s.binDir) // still locked? cleaned before the next install
	s.log("[core] 新内核 sing-box " + v + " 首次启动成功")
}

// rollbackPendingCore runs after a failed start: when the installed core is
// still pending, the previous core is put back and the version held, and true
// is returned (start again on the old core). Any start failure counts — a
// core that has never run here does not get the benefit of the doubt.
func (s *Service) rollbackPendingCore(startErr error) bool {
	v := coreupdate.PendingVersion(s.binDir)
	if v == "" {
		return false
	}
	coreupdate.ClearPending(s.binDir)
	if !coreupdate.HasBackup(s.binDir) {
		return false // the backup is gone (a client upgrade replaced the core): nothing to go back to
	}
	if err := coreupdate.Rollback(s.binDir); err != nil {
		s.log("[core] 新内核 sing-box " + v + " 启动失败，换回旧内核也失败：" + err.Error())
		return false
	}
	s.coreFollow().hold(v)
	s.log("[core] 新内核 sing-box " + v + " 首次启动失败（" + startErr.Error() + "），已换回旧内核，24 小时内不再自动安装这个版本")
	return true
}

// verifyNewCore checks a downloaded core before it replaces the installed
// one: it must run on this PC, and it must accept the config this client
// would start with right now (a build that dropped an option we generate
// would otherwise only show at the next start). Nothing is checked against a
// config when there is no node yet.
func (s *Service) verifyNewCore(exePath string) error {
	if err := coreupdate.VerifyCore(exePath); err != nil {
		return err
	}
	var reuse *planReuse
	if s.core.Running() {
		reuse = s.liveReuse()
	}
	plan, err := s.planStart(reuse)
	if err != nil {
		return nil
	}
	dir := filepath.Join(s.dataDir, "core-verify")
	defer os.RemoveAll(dir)
	return core.NewManager(exePath, dir, nil).CheckTUN(plan.node, plan.level, plan.route, plan.opts)
}
