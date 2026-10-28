package aienv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tidwall/gjson"
	"golang.org/x/sys/windows/registry"
)

// TaipeiTimezone is the Windows id matching a Taiwan exit. Same UTC+8 as
// China Standard Time: switching changes the zone name, not the clock.
const (
	TaipeiTimezone = "Taipei Standard Time"
	ChinaTimezone  = "China Standard Time"
)

const (
	taiwanCulture = "zh-TW"
	taiwanGeoID   = "237" // Windows GeoID of Taiwan (China = 45, Hong Kong = 104)
)

// forcedLanguages is the browser language list we force (first = navigator.language).
var forcedLanguages = []string{"zh-TW", "zh", "en-US", "en"}

var browserPolicyKeys = map[string]string{
	"chrome": `Software\Policies\Google\Chrome\ForcedLanguages`,
	"edge":   `Software\Policies\Microsoft\Edge\ForcedLanguages`,
}

var items = []item{
	{
		id: "timezone", name: "系统时区", target: TaipeiTimezone,
		note:     "Claude Code、浏览器都直接读系统时区；台北与北京同为 UTC+8，钟点不变",
		current:  func(*Manager) string { return TimezoneID() },
		done:     func(_ *Manager, cur string) bool { return cur == TaipeiTimezone },
		snapshot: func(*Manager) string { return TimezoneID() },
		apply:    func(*Manager) error { return run(30*time.Second, "tzutil.exe", "/s", TaipeiTimezone) },
		restore: func(_ *Manager, orig string) error {
			if orig == "" {
				return nil
			}
			return run(30*time.Second, "tzutil.exe", "/s", orig)
		},
	},
	{
		id: "culture", name: "区域格式", target: taiwanCulture,
		note:     "程序（Node / Claude Code）的默认语言区域跟它走；只影响日期、数字的显示格式，界面语言不变",
		current:  func(*Manager) string { return UserLocale() },
		done:     func(_ *Manager, cur string) bool { return strings.EqualFold(cur, taiwanCulture) },
		snapshot: func(*Manager) string { return UserLocale() },
		apply:    func(*Manager) error { return powershell("Set-Culture -CultureInfo " + taiwanCulture) },
		restore: func(_ *Manager, orig string) error {
			if orig == "" {
				return nil
			}
			return powershell("Set-Culture -CultureInfo " + psQuote(orig))
		},
	},
	{
		id: "homeloc", name: "所在地区", target: "台湾（GeoID " + taiwanGeoID + "）",
		note:     "Windows「国家或地区」，应用商店和部分程序会读",
		current:  func(*Manager) string { return geoName(homeGeoID()) },
		done:     func(*Manager, string) bool { return homeGeoID() == taiwanGeoID },
		snapshot: func(*Manager) string { return homeGeoID() },
		apply:    func(*Manager) error { return powershell("Set-WinHomeLocation -GeoId " + taiwanGeoID) },
		restore: func(_ *Manager, orig string) error {
			if _, err := strconv.Atoi(orig); err != nil {
				return nil
			}
			return powershell("Set-WinHomeLocation -GeoId " + orig)
		},
	},
	{
		id: "browserlang", name: "浏览器语言", target: strings.Join(forcedLanguages, ","),
		note: "Chrome / Edge 策略 ForcedLanguages：网页读到的语言变成繁体中文 + 英文，界面文字不变；重开浏览器生效，浏览器会显示「由贵单位管理」",
		current: func(*Manager) string {
			if BrowserLanguageForced() {
				return strings.Join(forcedLanguages, ",")
			}
			if l := BrowserLanguages(); l != "" {
				return l
			}
			return "未读到"
		},
		done:     func(*Manager, string) bool { return BrowserLanguageForced() },
		snapshot: func(*Manager) string { return browserSnapshot() },
		apply: func(*Manager) error {
			for _, p := range browserPolicyKeys {
				if err := writePolicy(p, forcedLanguages); err != nil {
					return err
				}
			}
			return nil
		},
		restore: func(_ *Manager, orig string) error { return browserRestore(orig) },
	},
	claudeItem,
	{
		id: "clock", name: "系统时间", target: "与标准时间同步",
		note:    "时间差太多会登录 / 授权失败；只是对时，没有原样可恢复",
		current: func(*Manager) string { return time.Now().Format("2006-01-02 15:04:05") },
		apply:   func(*Manager) error { return resyncClock() },
	},
	{
		id: "fonts", name: "中文字体 / Emoji",
		note: "网页能探测到中文字体和 Windows 表情。不改：删字体会乱码，繁体中文环境同样有中文字体，官方也没公开会看这一项",
	},
}

// TimezoneID returns the current Windows time zone id ("" if unreadable).
func TimezoneID() string {
	return regString(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\TimeZoneInformation`, "TimeZoneKeyName")
}

// UserLocale returns the user's regional format ("zh-CN", "" if unreadable).
func UserLocale() string {
	return regString(registry.CURRENT_USER, `Control Panel\International`, "LocaleName")
}

func homeGeoID() string {
	return regString(registry.CURRENT_USER, `Control Panel\International\Geo`, "Nation")
}

func geoName(id string) string {
	switch id {
	case "237":
		return "台湾"
	case "45":
		return "中国大陆"
	case "104":
		return "香港"
	case "":
		return "未读到"
	}
	return "GeoID " + id
}

// BrowserLanguageForced reports whether Chrome carries exactly our
// ForcedLanguages list (someone else's zh-TW policy is not ours).
func BrowserLanguageForced() bool {
	return slices.Equal(readPolicy(browserPolicyKeys["chrome"]), forcedLanguages)
}

// BrowserLanguages is Chrome's accept-languages of the default profile ("" = none).
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

func regString(root registry.Key, path, name string) string {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue(name)
	if err != nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(v), "\x00")
}

// readPolicy returns a list policy's values in order (nil = key absent).
func readPolicy(path string) []string {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()
	out := []string{}
	for i := 1; ; i++ {
		v, _, err := k.GetStringValue(strconv.Itoa(i))
		if err != nil {
			return out
		}
		out = append(out, v)
	}
}

func writePolicy(path string, vals []string) error {
	_ = registry.DeleteKey(registry.CURRENT_USER, path)
	k, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	for i, v := range vals {
		if err := k.SetStringValue(strconv.Itoa(i+1), v); err != nil {
			return err
		}
	}
	return nil
}

func browserSnapshot() string {
	snap := map[string][]string{}
	for name, p := range browserPolicyKeys {
		snap[name] = readPolicy(p) // nil = absent
	}
	raw, _ := json.Marshal(snap)
	return string(raw)
}

func browserRestore(orig string) error {
	snap := map[string][]string{}
	_ = json.Unmarshal([]byte(orig), &snap)
	for name, p := range browserPolicyKeys {
		if vals := snap[name]; vals != nil {
			if err := writePolicy(p, vals); err != nil {
				return err
			}
			continue
		}
		if err := registry.DeleteKey(registry.CURRENT_USER, p); err != nil && err != registry.ErrNotExist {
			return err
		}
	}
	return nil
}

func resyncClock() error {
	_ = run(30*time.Second, "sc.exe", "start", "w32time")
	time.Sleep(time.Second)
	if err := run(30*time.Second, "w32tm.exe", "/resync", "/force"); err != nil {
		return fmt.Errorf("对时失败（可在 Windows 设置 → 时间和语言里点「立即同步」）：%w", err)
	}
	return nil
}

func powershell(script string) error {
	return run(60*time.Second, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
}

// psQuote single-quotes a value for PowerShell.
func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func run(timeout time.Duration, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // no console flash
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
