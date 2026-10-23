package aiguard

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/tidwall/gjson"

	"golang.org/x/sys/windows/registry"
)

// 官方订阅用户的本机信号（业主 2026-10-23；依据 docs/memory/ai-guard.md「环境检测」）：
//   - 浏览器语言：navigator.languages / Accept-Language 报 zh-CN。用 Chrome / Edge 的
//     ForcedLanguages 策略（当前用户）固定成繁体中文 + 英文；副作用是浏览器显示「由贵单位管理」。
//   - Claude Code：官方开关 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 关掉遥测 / 错误上报 /
//     反馈上传（code.claude.com/docs/en/data-usage），写进 ~/.claude/settings.json 的 env。
// 两样都只在「恢复」时撤掉，且只撤我们写的。

// forcedLanguages is what we force (order matters: first = navigator.language).
var forcedLanguages = []string{"zh-TW", "zh", "en-US", "en"}

var browserPolicyKeys = []string{`Software\Policies\Google\Chrome\ForcedLanguages`, `Software\Policies\Microsoft\Edge\ForcedLanguages`}

// BrowserLanguageForced reports whether our ForcedLanguages policy is in place
// for Chrome (Edge follows the same key when it supports it).
func BrowserLanguageForced() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, browserPolicyKeys[0], registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("1")
	return err == nil && v == forcedLanguages[0]
}

// BrowserLanguages is Chrome's configured accept-languages of the default
// profile ("" = no Chrome / unreadable).
func BrowserLanguages() string {
	dir, err := os.UserCacheDir() // %LOCALAPPDATA%
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(dir, "Google", "Chrome", "User Data", "Default", "Preferences"))
	if err != nil {
		return ""
	}
	return gjson.GetBytes(raw, "intl.accept_languages").String()
}

// ForceBrowserLanguage writes the policy for Chrome and Edge (takes effect
// after the browser restarts).
func ForceBrowserLanguage() error {
	for _, p := range browserPolicyKeys {
		k, _, err := registry.CreateKey(registry.CURRENT_USER, p, registry.SET_VALUE)
		if err != nil {
			return err
		}
		for i, l := range forcedLanguages {
			if err := k.SetStringValue(strconv.Itoa(i+1), l); err != nil {
				k.Close()
				return err
			}
		}
		k.Close()
	}
	return nil
}

// UnforceBrowserLanguage removes the policy, only when it is still ours.
func UnforceBrowserLanguage() error {
	for _, p := range browserPolicyKeys {
		k, err := registry.OpenKey(registry.CURRENT_USER, p, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		v, _, _ := k.GetStringValue("1")
		k.Close()
		if v != forcedLanguages[0] {
			continue // someone else's policy
		}
		if err := registry.DeleteKey(registry.CURRENT_USER, p); err != nil {
			return err
		}
	}
	return nil
}
