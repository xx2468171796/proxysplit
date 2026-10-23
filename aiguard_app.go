package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/service"
)

// AI 劫持模式（设计 docs/AI强制走线路.md）：开启后
//   - 内核里 AI 服务一律走 POWER云 线路（service.SetAIGuard），不管哪个程序、哪种代理策略；
//   - 系统 DNS 锁（aiguard NRPT）：AI 域名只能由隧道里的 DNS 解析，ProxySplit 停了 / 退了 / 被杀了就解析不了，
//     AI 直接访问不通，绝不会用客户本机（国内）网络出去；
//   - 打开程序（含开机自启）就自动启动代理，不用手动点。
// 开关是这台电脑上持久的状态（<数据目录>/ai-hijack）：AI 编程官网客户第一次登录自动开启；
// **只有在软件里点「恢复」才关闭**——退出登录、关软件、重启电脑、删数据目录都不解除（锁还在 = 开启）。

var aiGuardMu sync.Mutex

// aiLockRetryAfter: a failed NRPT write is retried no sooner than this (the
// watchdog calls syncAIGuard every minute).
const aiLockRetryAfter = 10 * time.Minute

var aiLockFailedAt time.Time

const (
	hijackOn  = "on"
	hijackOff = "off" // the user pressed 恢复 in the app
)

func hijackFile() string { return filepath.Join(dataDir(), "ai-hijack") }

func readHijack() string {
	raw, _ := os.ReadFile(hijackFile())
	return strings.TrimSpace(string(raw))
}

func writeHijack(state string) error {
	if err := os.MkdirAll(dataDir(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(hijackFile(), []byte(state+"\n"), 0o644)
}

// aiGuardWanted: 劫持模式 is on. Undecided devices turn it on when the lock
// already exists (a reset data directory must not unlock) or an AI-site
// customer is signed in (development builds: the channel alone). Only
// SetAIHijack(false) — the in-app 恢复 — turns it off.
func (a *App) aiGuardWanted() bool {
	if a.svc == nil || a.lic == nil {
		return false
	}
	state := readHijack()
	if state != "" {
		on, _ := hijackDecision(state, false, false)
		return on
	}
	st := a.licenseStatus()
	on, record := hijackDecision(state, aiguard.Present(), st.Channel == channelAIGW && st.Enabled && st.SignedIn)
	if record {
		a.turnHijackOn()
	}
	return on
}

// hijackDecision is the 劫持模式 rule: a recorded choice always wins (only the
// in-app 恢复 records "off"); undecided devices switch on — and record it —
// when our lock already exists or an AI-site customer is signed in.
func hijackDecision(state string, lockPresent, aiCustomerSignedIn bool) (on, record bool) {
	switch state {
	case hijackOn:
		return true, false
	case hijackOff:
		return false, false
	}
	if lockPresent || aiCustomerSignedIn {
		return true, true
	}
	return false, false
}

// turnHijackOn records 劫持模式 on and, this once, turns on login autostart so
// AI works right after boot (a user may turn autostart off again later).
func (a *App) turnHijackOn() {
	if err := writeHijack(hijackOn); err != nil {
		a.svc.LogLine("[AI] 记录劫持模式失败：" + err.Error())
	}
	if !a.svc.GetAutostart() {
		if err := a.svc.SetAutostart(true); err == nil {
			a.svc.LogLine("[AI] 已开启开机自启，开机后 AI 也能直接用")
		}
	}
}

// AIHijackState is the 劫持模式 switch shown on the overview card.
type AIHijackState struct {
	On      bool `json:"on"`      // 劫持模式开着
	Locked  bool `json:"locked"`  // 系统 DNS 锁已加上
	Visible bool `json:"visible"` // 显示卡片：AI 编程官网客户，或劫持开着 / 恢复过
}

// GetAIHijack reports the switch.
func (a *App) GetAIHijack() AIHijackState {
	<-a.ready
	if a.svc == nil || a.lic == nil {
		return AIHijackState{}
	}
	on := a.aiGuardWanted()
	return AIHijackState{On: on, Locked: aiguard.Installed(), Visible: on || readHijack() != "" || a.licenseStatus().Channel == channelAIGW}
}

// SetAIHijack is the only way to turn 劫持模式 off (恢复) or back on, and only
// from inside the app. Returns "" or a Chinese error message.
func (a *App) SetAIHijack(on bool) string {
	<-a.ready
	if a.svc == nil {
		return "程序尚未初始化完成"
	}
	if !on {
		if err := writeHijack(hijackOff); err != nil {
			return "保存失败：" + err.Error()
		}
		a.syncAIGuard()
		if aiguard.Present() {
			return "解除系统 DNS 锁失败，详情看「日志」页"
		}
		a.svc.LogLine("[AI] 已在软件里恢复：劫持模式关闭，AI 不再强制走线路（关掉软件时 AI 会走本机网络）")
		return ""
	}
	a.turnHijackOn()
	a.svc.LogLine("[AI] 已开启劫持模式")
	return errStr(a.fixAIEnvItem("guard"))
}

// syncAIGuard brings the core rules and the DNS lock in line with
// aiGuardWanted. Cheap when nothing changed (one registry read).
func (a *App) syncAIGuard() {
	aiGuardMu.Lock()
	defer aiGuardMu.Unlock()
	want := a.aiGuardWanted()
	if err := a.svc.SetAIGuard(want); err != nil {
		a.svc.LogLine("[AI] 应用 AI 强制走线路时代理重启失败：" + err.Error())
	}
	switch {
	case want && !aiguard.Installed():
		if time.Since(aiLockFailedAt) < aiLockRetryAfter {
			return
		}
		if aiguard.GroupPolicyActive() {
			a.svc.LogLine("[AI] 这台电脑有域组策略 DNS 规则，AI 锁可能不生效（环境检测里会提示）")
		}
		if err := aiguard.Install(); err != nil {
			aiLockFailedAt = time.Now()
			a.svc.LogLine("[AI] " + err.Error())
			return
		}
		aiLockFailedAt = time.Time{}
		a.svc.LogLine("[AI] 已加 AI 访问锁：ProxySplit 不开时 AI 网站一律打不开，防止用本机 IP 访问")
	case !want && aiguard.Present():
		if err := aiguard.Remove(); err != nil {
			a.svc.LogLine("[AI] 解除 AI 访问锁失败：" + err.Error())
			return
		}
		a.svc.LogLine("[AI] 已解除 AI 访问锁")
	}
}

// autoStartForAI starts the proxy for an AI-site customer when it is not
// running yet (program opened, signed in, nodes ready): AI must never wait for
// someone to press 启动.
func (a *App) autoStartForAI() {
	if !a.aiGuardWanted() || !a.svc.HasNodes() {
		return
	}
	started, err := a.svc.StartIfStopped()
	if err != nil {
		a.svc.LogLine("[AI] 自动启动代理失败：" + err.Error())
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "ai-autostart-failed", err.Error())
		}
		return
	}
	if !started {
		return
	}
	a.watchNetBlocked()
	a.svc.LogLine("[AI] 已自动启动代理（劫持模式：打开即保护）")
}

// aiGuardBoot runs once at startup, after a download-ticket sign-in (if any)
// finished, so a fresh AI-site download is protected right away.
func (a *App) aiGuardBoot() {
	if run := a.autoLogin.Load(); run != nil {
		<-run.done
	}
	a.syncAIGuard()
	a.autoStartForAI()
}

// afterSignIn: an interactive sign-in may have made this an AI-site device.
func (a *App) afterSignIn() {
	go func() {
		a.syncAIGuard()
		a.autoStartForAI()
	}()
}

// CheckAIEnv runs the AI environment check (界面「AI 环境检测」卡片).
func (a *App) CheckAIEnv() service.AIEnvReport {
	<-a.ready
	if a.svc == nil {
		return service.AIEnvReport{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return a.svc.AIEnvCheck(ctx)
}

// FixAIEnv applies one fix from the check ("all" = every fixable item of a
// fresh check). Returns "" or a Chinese error message.
func (a *App) FixAIEnv(id string) string {
	<-a.ready
	if a.svc == nil {
		return "程序尚未初始化完成"
	}
	if id != "all" {
		return errStr(a.fixAIEnvItem(id))
	}
	var errs []string
	for _, it := range a.CheckAIEnv().Items {
		if it.Fix == "" {
			continue
		}
		if err := a.fixAIEnvItem(it.Fix); err != nil {
			errs = append(errs, it.Name+"："+err.Error())
		}
	}
	return strings.Join(errs, "；")
}

func (a *App) fixAIEnvItem(id string) error {
	switch id {
	case "guard":
		if !a.aiGuardWanted() {
			a.turnHijackOn()
		}
		aiGuardMu.Lock()
		aiLockFailedAt = time.Time{} // the user asked: try the lock again now
		aiGuardMu.Unlock()
		a.syncAIGuard()
		if !aiguard.Installed() {
			return errors.New("系统 DNS 锁没加上，详情看「日志」页")
		}
		if !a.svc.HasNodes() {
			return errors.New("还没有线路，请先添加节点或在 POWER云 开通")
		}
		if _, err := a.svc.StartIfStopped(); err != nil {
			return err
		}
		a.watchNetBlocked()
		return nil
	case "timezone":
		if err := aiguard.SetTimezone(aiguard.TaipeiTimezone); err != nil {
			return fmt.Errorf("改时区失败：%w", err)
		}
		a.svc.LogLine("[AI] 系统时区已改为台北时间（UTC+8，钟点不变）")
		return nil
	case "clock":
		return aiguard.ResyncClock()
	case "autostart":
		return a.svc.SetAutostart(true)
	}
	return fmt.Errorf("未知的修复项：%s", id)
}
