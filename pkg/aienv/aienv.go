// Package aienv 一键配置 / 一键恢复这台 Windows 电脑的「AI 使用环境」：时区、区域格式、所在地区、
// 浏览器语言、Claude Code 遥测、系统时间。目标是让本机信号和台湾出口一致（官方订阅防风控，
// 依据 ProxySplit docs/memory/ai-guard.md「环境检测」调研）。
//
// 可复用（ProxySplit、aigw 网关切换器）：只依赖标准库、golang.org/x/sys 和 tidwall/gjson|sjson，
// 不引用宿主的任何包。宿主给一个状态文件路径，然后调 Status / Apply / Restore：
//
//	m := aienv.New(filepath.Join(dataDir, "aienv-state.json"))
//	m.Apply()   // 全部配置（每项第一次改之前把原值记进状态文件）
//	m.Restore() // 按状态文件逐项还原成配置前的原样
//
// 字体 / Emoji 不改（删字体会乱码），只在 Status 里给说明。需要管理员权限的项（时区、对时）
// 要求宿主以管理员身份运行。
package aienv

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Status is one item as shown to the user.
type Status struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Current    string `json:"current"`    // what the PC has now
	Target     string `json:"target"`     // what Apply sets ("" = info only)
	Done       bool   `json:"done"`       // Current already matches Target
	Configured bool   `json:"configured"` // we changed it (Restore puts the original back)
	Restorable bool   `json:"restorable"` // false = one-off action (clock sync)
	Note       string `json:"note"`
}

// item is one configurable setting.
type item struct {
	id, name, target, note string
	current                func(m *Manager) string
	done                   func(m *Manager, cur string) bool
	snapshot               func(m *Manager) string // original value, saved before the first change
	apply                  func(m *Manager) error
	restore                func(m *Manager, orig string) error // nil = not restorable
}

// Manager applies and restores the items; safe for concurrent use.
type Manager struct {
	StateFile string // original values of what we changed (JSON id → value)
	// ClaudeSettings is Claude Code's settings.json ("" = ~/.claude/settings.json).
	ClaudeSettings string
	mu             sync.Mutex
}

// New returns a manager keeping its state in stateFile.
func New(stateFile string) *Manager { return &Manager{StateFile: stateFile} }

func (m *Manager) claudePath() string {
	if m.ClaudeSettings != "" {
		return m.ClaudeSettings
	}
	return ClaudeSettingsPath()
}

func (m *Manager) load() map[string]string {
	st := map[string]string{}
	if raw, err := os.ReadFile(m.StateFile); err == nil {
		_ = json.Unmarshal(raw, &st)
	}
	return st
}

func (m *Manager) save(st map[string]string) error {
	if len(st) == 0 {
		err := os.Remove(m.StateFile)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	raw, _ := json.MarshalIndent(st, "", "  ")
	if err := os.MkdirAll(filepath.Dir(m.StateFile), 0o755); err != nil {
		return err
	}
	tmp := m.StateFile + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, m.StateFile)
}

// Status lists every item with its current value.
func (m *Manager) Status() []Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.load()
	var out []Status
	for _, it := range items {
		s := Status{ID: it.id, Name: it.name, Target: it.target, Note: it.note, Restorable: it.restore != nil}
		if it.current != nil {
			s.Current = it.current(m)
		}
		if it.done != nil {
			s.Done = it.done(m, s.Current)
		}
		_, s.Configured = st[it.id]
		out = append(out, s)
	}
	return out
}

// Configured reports whether anything we changed can still be restored.
func (m *Manager) Configured() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.load()) > 0
}

// Apply configures the given items (none = all). Each item's original value is
// recorded once, before its first change, so repeated Apply keeps the true
// original. Errors of single items are joined; the others still run.
func (m *Manager) Apply(ids ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.load()
	var errs []string
	for _, it := range pick(ids) {
		if it.apply == nil {
			continue
		}
		if it.done != nil && it.current != nil && it.done(m, it.current(m)) && it.restore != nil {
			continue
		}
		if _, ok := st[it.id]; !ok && it.restore != nil {
			st[it.id] = it.snapshot(m)
			if err := m.save(st); err != nil {
				return err
			}
		}
		if err := it.apply(m); err != nil {
			errs = append(errs, it.name+"："+err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "；"))
	}
	return nil
}

// Restore puts back the original values of the given items (none = all we
// changed) and forgets them.
func (m *Manager) Restore(ids ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.load()
	var errs []string
	for _, it := range pick(ids) {
		orig, ok := st[it.id]
		if !ok || it.restore == nil {
			continue
		}
		// Changed again by the user (or IT) since we configured it: theirs now —
		// forget our record instead of overwriting their choice.
		if it.done != nil && it.current != nil && !it.done(m, it.current(m)) {
			delete(st, it.id)
			continue
		}
		if err := it.restore(m, orig); err != nil {
			errs = append(errs, it.name+"："+err.Error())
			continue
		}
		delete(st, it.id)
	}
	if err := m.save(st); err != nil {
		return err
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "；"))
	}
	return nil
}

// Adopt records orig as the original of id without changing anything — for a
// host that changed the setting itself before using this package.
func (m *Manager) Adopt(id, orig string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.load()
	if _, ok := st[id]; ok {
		return nil
	}
	st[id] = orig
	return m.save(st)
}

func pick(ids []string) []item {
	if len(ids) == 0 {
		return items
	}
	var out []item
	for _, it := range items {
		for _, id := range ids {
			if it.id == id {
				out = append(out, it)
			}
		}
	}
	return out
}

var errUnsupported = fmt.Errorf("只支持 Windows")
