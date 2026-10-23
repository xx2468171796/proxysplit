package aiguard

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

// Machine facts for the AI environment check (internal/service/aienv.go) and
// the fixes it offers. Each is a single read or one fixed command.

// TaipeiTimezone is the Windows id of the time zone matching our AI exit
// (Taiwan home broadband). Same UTC+8 offset as China Standard Time: switching
// changes the zone name apps and browsers report, not the clock.
const TaipeiTimezone = "Taipei Standard Time"

// TimezoneID returns the current Windows time zone id ("" if unreadable).
func TimezoneID() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\TimeZoneInformation`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue("TimeZoneKeyName")
	if err != nil {
		return ""
	}
	return strings.TrimRight(v, "\x00 ")
}

// UserLocale returns the user's Windows display locale ("zh-CN", "" if unreadable).
func UserLocale() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Control Panel\International`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue("LocaleName")
	return strings.TrimSpace(v)
}

// SetTimezone switches the system time zone (tzutil, ships with Windows).
func SetTimezone(id string) error {
	return run(30*time.Second, "tzutil.exe", "/s", id)
}

// ResyncClock starts the Windows time service if needed and syncs now.
func ResyncClock() error {
	_ = run(30*time.Second, "sc.exe", "start", "w32time")
	time.Sleep(time.Second)
	if err := run(30*time.Second, "w32tm.exe", "/resync", "/force"); err != nil {
		return fmt.Errorf("对时失败（可在 Windows 设置 → 时间和语言里点「立即同步」）：%w", err)
	}
	return nil
}

var proxyEnvNames = []string{"HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"}

// ProxyEnv returns proxy environment variables set for this user or machine
// (name → value). Programs started later (Claude Code, Codex, VS Code) inherit
// them and connect through that proxy instead of the tunnel deciding the exit.
func ProxyEnv() map[string]string {
	out := map[string]string{}
	read := func(root registry.Key, path string) {
		k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
		if err != nil {
			return
		}
		defer k.Close()
		for _, n := range proxyEnvNames {
			if v, _, err := k.GetStringValue(n); err == nil && strings.TrimSpace(v) != "" {
				out[strings.ToUpper(n)] = v
			}
		}
	}
	read(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`)
	read(registry.CURRENT_USER, `Environment`)
	for _, n := range proxyEnvNames {
		if v := strings.TrimSpace(os.Getenv(n)); v != "" {
			out[strings.ToUpper(n)] = v
		}
	}
	return out
}

func run(timeout time.Duration, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return fmt.Errorf("%v %s", err, msg)
	}
	return nil
}
