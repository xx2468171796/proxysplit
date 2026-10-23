package main

import (
	"os"
	"path/filepath"
	"sync"

	"proxysplit/pkg/aienv"
)

// 环境配置（设置 → AI 劫持 → 环境配置）：把这台 Windows 的时区、区域格式、所在地区、浏览器语言、
// Claude Code 遥测、系统时间一键配好，一键恢复成原样。实现在 pkg/aienv（可复用到 aigw）；
// 和 AI 劫持互相独立：劫持管网络，这里管 Windows 设置。

var (
	envOnce sync.Once
	envMgr  *aienv.Manager
)

func (a *App) env() *aienv.Manager {
	envOnce.Do(func() {
		envMgr = aienv.New(filepath.Join(dataDir(), "aienv-state.json"))
		// v1.9.87 set these from the AI check without a snapshot: adopt them so
		// 一键恢复 also undoes them (both did not exist before we added them).
		legacy := filepath.Join(dataDir(), "claude-quiet-ours")
		if _, err := os.Stat(legacy); err == nil {
			if envMgr.Adopt("claudecode", aienv.Absent) == nil {
				os.Remove(legacy)
			}
		}
		if aienv.BrowserLanguageForced() {
			_ = envMgr.Adopt("browserlang", "{}")
		}
	})
	return envMgr
}

// GetEnvConfig lists the environment items with their current values.
func (a *App) GetEnvConfig() []aienv.Status {
	<-a.ready
	return a.env().Status()
}

// ApplyEnvConfig configures the given items (empty = all). Returns "" or a
// Chinese error message.
func (a *App) ApplyEnvConfig(ids []string) string {
	<-a.ready
	err := a.env().Apply(ids...)
	if a.svc != nil {
		if err != nil {
			a.svc.LogLine("[AI] 环境配置部分失败：" + err.Error())
		} else {
			a.svc.LogLine("[AI] 已一键配置 AI 使用环境（时区 / 区域 / 浏览器语言 / Claude Code …）")
		}
	}
	return errStr(err)
}

// RestoreEnvConfig puts every setting we changed back to its original value.
func (a *App) RestoreEnvConfig() string {
	<-a.ready
	err := a.env().Restore()
	if a.svc != nil {
		if err != nil {
			a.svc.LogLine("[AI] 环境恢复部分失败：" + err.Error())
		} else {
			a.svc.LogLine("[AI] 已把 AI 使用环境恢复成配置前的原样")
		}
	}
	return errStr(err)
}

// applyEnv is one item from the AI check's fix buttons.
func (a *App) applyEnv(id string) error {
	if err := a.env().Apply(id); err != nil {
		return err
	}
	if a.svc != nil {
		a.svc.LogLine("[AI] 已配置：" + id + "（可在「环境配置」一键恢复）")
	}
	return nil
}
