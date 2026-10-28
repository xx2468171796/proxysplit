package main

import (
	"errors"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/configsync"
	"proxysplit/internal/license"
)

// Config export / import, member cloud sync, named cloud profiles and share
// codes (docs/plan-2026-10-29-free-sync-phone.md). Every restore goes
// through a preview → confirm step and backs the current config up first
// (one-step undo). Bundles never carry POWER云 lines or account data.

// ImportPreview is the confirm-dialog summary of a pending import.
type ImportPreview struct {
	Preview  configsync.Preview `json:"preview"`
	Canceled bool               `json:"canceled,omitempty"`
	Err      string             `json:"err,omitempty"`
}

// ProfilesResult lists the member's cloud configs and the tier quota.
type ProfilesResult struct {
	Items []license.Profile `json:"items"`
	Quota int               `json:"quota"`
	Used  int               `json:"used"`
	Err   string            `json:"err,omitempty"`
}

// ShareResult carries a new share code.
type ShareResult struct {
	Code string `json:"code"`
	Err  string `json:"err,omitempty"`
}

const maxImportBytes = 8 << 20

func (a *App) initConfigSync() {
	member := func() bool {
		st := a.lic.Status()
		return st.Enabled && st.SignedIn && st.Member && !st.DeviceLimitReached
	}
	notify := func(st configsync.Status) { runtime.EventsEmit(a.ctx, "configsync", st) }
	a.cfgSync = configsync.NewSyncer(dataDir(), a.lic.DeviceName(), a.svc, a.lic, member, notify)
}

// configSyncLoop: reconcile shortly after launch, then debounce local
// changes (10 s ticks) and look for newer cloud copies every 5 minutes.
func (a *App) configSyncLoop() {
	if a.cfgSync == nil {
		return
	}
	select {
	case <-time.After(8 * time.Second):
	case <-a.ctx.Done():
		return
	}
	a.cfgSync.Startup()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for n := 1; ; n++ {
		select {
		case <-ticker.C:
			a.cfgSync.Tick()
			if n%30 == 0 {
				a.cfgSync.Startup()
			}
		case <-a.ctx.Done():
			return
		}
	}
}

func (a *App) configSyncAfterSignIn() {
	_ = a.lic.RefreshProfile()
	if a.cfgSync != nil {
		a.cfgSync.Startup()
	}
}

// friendlyErr turns server error codes of these features into plain Chinese.
func friendlyErr(err error) string {
	if err == nil {
		return ""
	}
	var apiErr *license.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Code {
		case "SYNC_MEMBER_ONLY":
			return "云端配置是会员功能，开通会员后就能用"
		case "SHARE_INVALID":
			return "分享码或分享密码不对，请核对后再试"
		case "RESTORE_PASSWORD_WRONG":
			return "恢复密码不对"
		}
	}
	return err.Error()
}

func (a *App) syncReady() error {
	<-a.ready
	if a.svc == nil || a.lic == nil || a.cfgSync == nil {
		return errors.New("程序尚未初始化完成")
	}
	return nil
}

// ExportConfig saves the config bundle to a user-chosen file. "" = done / canceled.
func (a *App) ExportConfig() string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出配置",
		DefaultFilename: "proxysplit-config-" + time.Now().Format("20060102") + ".json",
		Filters:         []runtime.FileFilter{{DisplayName: "配置文件 (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return ""
	}
	b, err := configsync.Snapshot(a.svc, a.lic.DeviceName())
	if err != nil {
		return err.Error()
	}
	text, err := b.Encode()
	if err != nil {
		return err.Error()
	}
	return errStr(os.WriteFile(path, []byte(text), 0o600))
}

func (a *App) stage(b configsync.Bundle, name string) ImportPreview {
	a.pendingCfg.Store(&b)
	p := configsync.PreviewOf(b)
	p.Name = name
	return ImportPreview{Preview: p}
}

// ImportConfig reads a config file and returns its preview; ConfirmImport applies it.
func (a *App) ImportConfig() ImportPreview {
	if err := a.syncReady(); err != nil {
		return ImportPreview{Err: err.Error()}
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "导入配置",
		Filters: []runtime.FileFilter{{DisplayName: "配置文件 (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return ImportPreview{Canceled: true}
	}
	f, err := os.Open(path)
	if err != nil {
		return ImportPreview{Err: err.Error()}
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxImportBytes+1))
	if err != nil {
		return ImportPreview{Err: err.Error()}
	}
	if len(raw) > maxImportBytes {
		return ImportPreview{Err: "文件太大，不像是 ProxySplit 配置"}
	}
	b, err := configsync.Parse(string(raw))
	if err != nil {
		return ImportPreview{Err: err.Error()}
	}
	return a.stage(b, "")
}

// ConfirmImport applies the pending bundle's chosen sections (empty = all),
// backing the current config up first.
func (a *App) ConfirmImport(sections []string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	b := a.pendingCfg.Load()
	if b == nil {
		return "没有待导入的配置，请重新选择"
	}
	if err := configsync.Apply(a.svc, dataDir(), *b, sections); err != nil {
		return err.Error()
	}
	a.pendingCfg.Store(nil)
	return ""
}

// CancelImport drops the pending bundle.
func (a *App) CancelImport() { a.pendingCfg.Store(nil) }

// UndoImport restores the config from before the last import / restore.
func (a *App) UndoImport() string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	return errStr(configsync.Undo(a.svc, dataDir()))
}

// GetSyncStatus is the 「配置与同步」 status line.
func (a *App) GetSyncStatus() configsync.Status {
	if a.syncReady() != nil {
		return configsync.Status{}
	}
	return a.cfgSync.Status()
}

// SyncNow runs one sync round right away.
func (a *App) SyncNow() string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	err := a.cfgSync.SyncNow()
	if errors.Is(err, license.ErrSyncConflict) {
		return ""
	}
	return friendlyErr(err)
}

// SetSyncEnabled turns automatic cloud sync on / off.
func (a *App) SetSyncEnabled(on bool) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	a.cfgSync.SetEnabled(on)
	return ""
}

// ResolveSyncConflict: choice "cloud" (用云端) or "local" (用本机).
func (a *App) ResolveSyncConflict(choice string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	return friendlyErr(a.cfgSync.Resolve(choice))
}

// GetConfigProfiles lists the saved cloud configs.
func (a *App) GetConfigProfiles() ProfilesResult {
	if err := a.syncReady(); err != nil {
		return ProfilesResult{Items: []license.Profile{}, Err: err.Error()}
	}
	list, err := a.lic.ListProfiles()
	return ProfilesResult{Items: list.Items, Quota: list.Quota, Used: list.Used, Err: friendlyErr(err)}
}

func validProfileName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || utf8.RuneCountInString(n) > 40 {
		return "", errors.New("名称不能为空，最多 40 个字")
	}
	return n, nil
}

func (a *App) snapshotText() (string, error) {
	b, err := configsync.Snapshot(a.svc, a.lic.DeviceName())
	if err != nil {
		return "", err
	}
	return b.Encode()
}

// SaveConfigProfile saves the current config as a new named cloud config.
func (a *App) SaveConfigProfile(name string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	n, err := validProfileName(name)
	if err != nil {
		return err.Error()
	}
	text, err := a.snapshotText()
	if err != nil {
		return err.Error()
	}
	_, err = a.lic.CreateProfile(n, text)
	return friendlyErr(err)
}

// OverwriteConfigProfile replaces a cloud config with the current config.
func (a *App) OverwriteConfigProfile(id string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	text, err := a.snapshotText()
	if err != nil {
		return err.Error()
	}
	return friendlyErr(a.lic.UpdateProfile(id, nil, &text))
}

// RenameConfigProfile renames a cloud config.
func (a *App) RenameConfigProfile(id, name string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	n, err := validProfileName(name)
	if err != nil {
		return err.Error()
	}
	return friendlyErr(a.lic.UpdateProfile(id, &n, nil))
}

// DeleteConfigProfile deletes a cloud config (its share code stops working).
func (a *App) DeleteConfigProfile(id string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	return friendlyErr(a.lic.DeleteProfile(id))
}

func (a *App) stagePayload(np license.NamedPayload, err error) ImportPreview {
	if err != nil {
		return ImportPreview{Err: friendlyErr(err)}
	}
	b, err := configsync.Parse(np.Payload)
	if err != nil {
		return ImportPreview{Err: err.Error()}
	}
	return a.stage(b, np.Name)
}

// PreviewConfigProfile downloads a cloud config (restore password if it has
// one) and stages it; ConfirmImport applies it.
func (a *App) PreviewConfigProfile(id, password string) ImportPreview {
	if err := a.syncReady(); err != nil {
		return ImportPreview{Err: err.Error()}
	}
	return a.stagePayload(a.lic.RestoreProfile(id, password))
}

// SetConfigProfilePassword sets / changes / clears (next "") a restore password.
func (a *App) SetConfigProfilePassword(id, next, current string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	if next != "" && (len(next) < 4 || len(next) > 64) {
		return "恢复密码 4 到 64 位"
	}
	return friendlyErr(a.lic.SetProfileRestorePassword(id, next, current))
}

// ShareConfigProfile turns sharing on with a password and returns the code.
func (a *App) ShareConfigProfile(id, password string) ShareResult {
	if err := a.syncReady(); err != nil {
		return ShareResult{Err: err.Error()}
	}
	if len(password) < 4 || len(password) > 64 {
		return ShareResult{Err: "分享密码 4 到 64 位"}
	}
	code, err := a.lic.ShareProfile(id, password)
	return ShareResult{Code: code, Err: friendlyErr(err)}
}

// UnshareConfigProfile stops sharing a cloud config.
func (a *App) UnshareConfigProfile(id string) string {
	if err := a.syncReady(); err != nil {
		return err.Error()
	}
	return friendlyErr(a.lic.UnshareProfile(id))
}

// PreviewSharedConfig fetches someone's shared config by code + password
// and stages it; ConfirmImport applies it.
func (a *App) PreviewSharedConfig(code, password string) ImportPreview {
	if err := a.syncReady(); err != nil {
		return ImportPreview{Err: err.Error()}
	}
	if strings.TrimSpace(code) == "" || password == "" {
		return ImportPreview{Err: "请输入分享码和分享密码"}
	}
	return a.stagePayload(a.lic.ImportShare(code, password))
}
