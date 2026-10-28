package main

// 清除与重置中心的 Wails 绑定（internal/service/reset*.go；docs/memory/reset-center.md）。
// 这里登记需要宿主才能做的两项（本地日志队列、WinDivert / Xray 校验重下），并给每次
// 重置记一条 reset.run 事件。AI 劫持的开关与锁不在任何一项里：解除只能用「恢复」按钮。

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/coreupdate"
	"proxysplit/internal/service"
	"proxysplit/internal/telemetry"
)

// ResetCenter is the reset page snapshot.
type ResetCenter struct {
	Items      []service.ResetItem `json:"items"`
	LastBackup string              `json:"lastBackup"` // newest undoable backup ("" = none)
	Confirm    string              `json:"confirm"`    // text 恢复出厂 needs
}

// registerResetters wires the host-side items (called once at startup).
func registerResetters(bin string) {
	service.RegisterResetter(service.ResetLogSpool, func(ctx context.Context) error {
		ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		telemetry.FlushAndPurge(ctx, dataDir())
		return nil
	})
	service.RegisterResetter(service.ResetBinaries, func(ctx context.Context) error {
		return verifyBinaries(bin)
	})
}

// verifyBinaries checks Xray (always) and WinDivert (only when it was ever
// downloaded — it is fetched on demand to keep Defender quiet) against the
// pinned SHA256 and re-downloads what is missing or damaged.
func verifyBinaries(bin string) error {
	var errs []error
	if raw, err := xrayFS.ReadFile(xrayDir + "xray-release.json"); err == nil {
		if rel, err := coreupdate.ParseXrayRelease(raw); err == nil && !coreupdate.XrayInstalled(bin, rel) {
			load := func() ([]byte, error) { return xrayFS.ReadFile(xrayDir + coreupdate.XrayExe) }
			if err := coreupdate.EnsureBundledXray(bin, load, rel); err != nil {
				if err := coreupdate.FetchXray(bin, rel, ""); err != nil {
					errs = append(errs, fmt.Errorf("Xray：%w", err))
				}
			}
		}
	}
	if _, err := os.Stat(filepath.Join(bin, "WinDivert.dll")); err == nil {
		if err := coreupdate.EnsureWinDivert(bin); err != nil {
			errs = append(errs, fmt.Errorf("WinDivert：%w", err))
		}
	}
	return errors.Join(errs...)
}

// GetResetCenter lists every reset item with live preview counts.
func (a *App) GetResetCenter() ResetCenter {
	if a.svc == nil {
		return ResetCenter{Items: []service.ResetItem{}, Confirm: service.FactoryConfirmText}
	}
	return ResetCenter{Items: a.svc.ResetItems(), LastBackup: a.svc.LastResetBackup(), Confirm: service.FactoryConfirmText}
}

// RunReset runs the chosen items; confirm is the typed text for 恢复出厂.
func (a *App) RunReset(ids []string, confirm string) service.ResetReport {
	if a.svc == nil {
		return service.ResetReport{Results: []service.ResetResult{}}
	}
	return tmReset(a.svc.RunReset(context.Background(), ids, confirm))
}

// UndoReset restores the configuration saved right before the last reset.
func (a *App) UndoReset() string {
	if a.svc == nil {
		return "服务还没准备好"
	}
	start := time.Now()
	name, err := a.svc.UndoReset()
	telemetry.Op(telemetry.ResetUndo, start, err, map[string]any{"backup": name})
	return errStr(err)
}

// tmReset records one reset.run event: items, ok, failed, ms.
func tmReset(r service.ResetReport) service.ResetReport {
	items := make([]string, 0, len(r.Results))
	var failed []string
	for _, x := range r.Results {
		items = append(items, x.ID)
		if !x.OK {
			failed = append(failed, x.ID+": "+x.Message)
		}
	}
	payload := map[string]any{"items": items, "ok": r.OK, "failed": r.Failed, "ms": r.Ms, "backup": r.Backup != ""}
	var err error
	if len(failed) > 0 {
		err = telemetry.Errorf("%s", strings.Join(failed, "; "))
	}
	telemetry.Emit(telemetry.ResetRun, statusOf(err), err, payload)
	return r
}

func statusOf(err error) telemetry.Status {
	if err != nil {
		return telemetry.Fail
	}
	return telemetry.OK
}
