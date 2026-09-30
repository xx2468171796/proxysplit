package main

import (
	"os"
	"path/filepath"
	"strings"

	"proxysplit/internal/license"
)

// 中转站渠道：AI 编程官网（aigw）的客户由推广员带来，客户端不显示作者联系方式
// （QQ 群 / 客服微信 / 赞赏码 / 官网 / GitHub），免得客户绕过推广员直接找作者。
//
// 认定来源（任一即可，认定后写进 <数据目录>/channel 永久生效，退出登录、改文件名、自动更新都不丢）：
//   - 从 AI 编程官网下载的安装包文件名带 proxysplit-ai（服务端 /v1/download/proxysplit-ai-latest.exe）；
//   - 账号来自中转站：服务端登录 / 刷新返回 user.channel = "aigw"（经 POWER云 用 AI 官网账号登录过）。
const channelAIGW = "aigw"

func channelFile() string { return filepath.Join(dataDir(), "channel") }

// exeMarksAIGW: the installer downloaded from the AI site is named
// proxysplit-ai-latest.exe (browsers may append " (1)").
func exeMarksAIGW(exe string) bool {
	return strings.Contains(strings.ToLower(filepath.Base(exe)), "proxysplit-ai")
}

// resolveChannel merges the persisted marker, the account's channel and the
// executable name; the marker only ever goes "" → "aigw".
func resolveChannel(file, accountChannel, exe string) (channel string, persist bool) {
	if raw, err := os.ReadFile(file); err == nil && strings.TrimSpace(string(raw)) == channelAIGW {
		return channelAIGW, false
	}
	if accountChannel == channelAIGW || exeMarksAIGW(exe) {
		return channelAIGW, true
	}
	return "", false
}

func (a *App) channel(accountChannel string) string {
	exe, _ := os.Executable()
	ch, persist := resolveChannel(channelFile(), accountChannel, exe)
	if persist {
		_ = os.MkdirAll(dataDir(), 0o755)
		_ = os.WriteFile(channelFile(), []byte(ch+"\n"), 0o644)
	}
	return ch
}

// licenseStatus is lic.Status() with the device-level channel filled in, so the
// UI hides contacts even before sign-in when the installer came from the AI site.
func (a *App) licenseStatus() license.Status {
	st := a.lic.Status()
	st.Channel = a.channel(st.Channel)
	return st
}
