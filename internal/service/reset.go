package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// 清除与重置中心（docs/memory/reset-center.md）：所有「清缓存 / 修网络 / 重置配置」
// 都登记在这里，界面、诊断接口 POST /api/reset 和 MCP 共用一份清单。
//
// 红线：没有任何一项会关闭 AI 劫持、删除它的开关文件（<数据目录>/ai-hijack）或
// NRPT 锁；配置重置只改 config.json，AI 劫持与环境配置状态都在别的文件里。

// Reset groups (UI sections).
const (
	ResetGroupCache   = "cache"   // 缓存
	ResetGroupNetwork = "network" // 网络修复
	ResetGroupConfig  = "config"  // 配置重置
)

// Danger levels.
const (
	DangerSafe    = "safe"    // 只清缓存，不丢任何设置
	DangerCaution = "caution" // 丢部分设置，自动备份可撤销
	DangerHigh    = "danger"  // 丢大量设置，必须确认
)

// FactoryConfirmText must be typed by the user before 恢复出厂 runs.
const FactoryConfirmText = "确认重置"

// Reserved IDs for resetters registered by other packages later.
const (
	ResetNodeResolveCache = "noderesolve-cache"
	ResetDNSPrewarm       = "dns-prewarm"
	ResetLogSpool         = "log-spool"
	ResetBinaries         = "binaries"
)

// ResetItem is one row of the reset center.
type ResetItem struct {
	ID        string   `json:"id"`
	Group     string   `json:"group"`
	Title     string   `json:"title"`
	Effect    string   `json:"effect"`
	Restarts  bool     `json:"restarts"`            // may restart the core
	Danger    string   `json:"danger"`              // safe | caution | danger
	Lost      []string `json:"lost,omitempty"`      // what the user loses (confirm dialog)
	Kept      []string `json:"kept,omitempty"`      // what is explicitly preserved
	Confirm   string   `json:"confirm,omitempty"`   // text the user must type
	Backup    bool     `json:"backup"`              // config backup made first (undoable)
	Available bool     `json:"available"`           // false = reserved, not wired yet
	Count     int      `json:"count"`               // preview count (rules, nodes …), -1 = n/a
	CountText string   `json:"countText,omitempty"` // human preview of Count
}

// ResetResult is the outcome of one item.
type ResetResult struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// ResetReport is the outcome of RunReset.
type ResetReport struct {
	Results []ResetResult `json:"results"`
	Backup  string        `json:"backup,omitempty"` // backup file name, "" = none made
	OK      int           `json:"ok"`
	Failed  int           `json:"failed"`
	Ms      int64         `json:"ms"`
}

// Resetter is a reset action registered from outside this file.
type Resetter func(ctx context.Context) error

// resetAction is the built-in action form (returns a user message).
type resetAction func(s *Service, ctx context.Context) (string, error)

var (
	resetRegMu sync.Mutex
	resetReg   = map[string]Resetter{}
)

// RegisterResetter plugs a reset action into the center. id must be one of the
// catalog IDs (reserved ones such as "noderesolve-cache" / "dns-prewarm"
// become available once registered) or a new id, which is listed under 缓存.
func RegisterResetter(id string, fn Resetter) {
	resetRegMu.Lock()
	defer resetRegMu.Unlock()
	if fn == nil {
		delete(resetReg, id)
		return
	}
	resetReg[id] = fn
}

func registeredResetter(id string) Resetter {
	resetRegMu.Lock()
	defer resetRegMu.Unlock()
	return resetReg[id]
}

func registeredIDs() []string {
	resetRegMu.Lock()
	defer resetRegMu.Unlock()
	ids := make([]string, 0, len(resetReg))
	for id := range resetReg {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

type resetDef struct {
	item   ResetItem
	action resetAction // nil = only a registered Resetter can run it
	count  func(s *Service) (int, string)
}

// ResetItems lists every item in display order, with live preview counts.
func (s *Service) ResetItems() []ResetItem {
	defs := resetCatalog()
	out := make([]ResetItem, 0, len(defs))
	known := map[string]bool{}
	for _, d := range defs {
		known[d.item.ID] = true
		it := d.item
		it.Available = d.action != nil || registeredResetter(it.ID) != nil
		it.Count = -1
		if d.count != nil {
			it.Count, it.CountText = d.count(s)
		}
		out = append(out, it)
	}
	for _, id := range registeredIDs() {
		if !known[id] {
			out = append(out, ResetItem{ID: id, Group: ResetGroupCache, Title: id, Effect: "由其它模块登记的清除项", Danger: DangerSafe, Available: true, Count: -1})
		}
	}
	return out
}

func findResetDef(id string) (resetDef, bool) {
	for _, d := range resetCatalog() {
		if d.item.ID == id {
			return d, true
		}
	}
	if registeredResetter(id) != nil {
		return resetDef{item: ResetItem{ID: id, Group: ResetGroupCache, Title: id, Danger: DangerSafe}}, true
	}
	return resetDef{}, false
}

// RunReset runs the given items in catalog order (config resets first, then
// network repair, then caches). confirm must equal FactoryConfirmText for
// items that require it. A config backup is written once before the first
// config item.
func (s *Service) RunReset(ctx context.Context, ids []string, confirm string) ResetReport {
	start := time.Now()
	var rep ResetReport
	want := map[string]bool{}
	for _, id := range ids {
		want[strings.TrimSpace(id)] = true
	}
	var order []resetDef
	for _, g := range []string{ResetGroupConfig, ResetGroupNetwork, ResetGroupCache} {
		for _, d := range resetCatalog() {
			if d.item.Group == g && want[d.item.ID] {
				order = append(order, d)
				delete(want, d.item.ID)
			}
		}
	}
	extra := make([]string, 0, len(want))
	for id := range want {
		extra = append(extra, id)
	}
	sort.Strings(extra)
	for _, id := range extra {
		d, ok := findResetDef(id)
		if !ok {
			rep.Results = append(rep.Results, ResetResult{ID: id, Title: id, Message: "没有这一项"})
			continue
		}
		order = append(order, d)
	}
	for _, d := range order {
		res := ResetResult{ID: d.item.ID, Title: d.item.Title}
		msg, err := s.runResetDef(ctx, d, confirm, &rep)
		res.OK, res.Message = err == nil, msg
		if err != nil {
			res.Message = err.Error()
		}
		rep.Results = append(rep.Results, res)
	}
	for _, r := range rep.Results {
		if r.OK {
			rep.OK++
		} else {
			rep.Failed++
		}
	}
	rep.Ms = time.Since(start).Milliseconds()
	s.log(fmt.Sprintf("[reset] 完成 %d 项，失败 %d 项", rep.OK, rep.Failed))
	return rep
}

func (s *Service) runResetDef(ctx context.Context, d resetDef, confirm string, rep *ResetReport) (string, error) {
	if d.item.Confirm != "" && strings.TrimSpace(confirm) != d.item.Confirm {
		return "", fmt.Errorf("需要输入「%s」才能执行", d.item.Confirm)
	}
	if d.item.Backup && rep.Backup == "" {
		name, err := s.backupBeforeReset()
		if err != nil {
			return "", fmt.Errorf("自动备份失败，未执行：%w", err)
		}
		rep.Backup = name
	}
	if fn := registeredResetter(d.item.ID); fn != nil {
		if err := fn(ctx); err != nil {
			return "", err
		}
		return "已完成", nil
	}
	if d.action == nil {
		return "", errors.New("这一项还没有接入（等待对应功能上线）")
	}
	return d.action(s, ctx)
}

// ResetConfig restores all settings to defaults while keeping nodes and
// subscriptions (legacy binding; the reset center's "all-settings" item).
func (s *Service) ResetConfig() {
	_, _ = s.resetAllSettings(context.Background())
}
