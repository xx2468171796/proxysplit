package aienv

import (
	"os"
	"os/exec"
	"strings"
)

// On macOS only the Claude Code switch can be applied; the zone and locale
// are read (IANA zone, AppleLocale) so the report shows real values.
var items = []item{claudeItem}

// TaipeiTimezone / ChinaTimezone are the IANA ids on macOS.
const (
	TaipeiTimezone = "Asia/Taipei"
	ChinaTimezone  = "Asia/Shanghai"
)

// TimezoneID is the system zone (/etc/localtime -> …/zoneinfo/Asia/Shanghai).
func TimezoneID() string {
	p, err := os.Readlink("/etc/localtime")
	if err != nil {
		return ""
	}
	if i := strings.Index(p, "zoneinfo/"); i >= 0 {
		return p[i+len("zoneinfo/"):]
	}
	return ""
}

// UserLocale is the region format as "zh-CN" (AppleLocale is "zh_CN").
func UserLocale() string {
	out, err := exec.Command("/usr/bin/defaults", "read", "-g", "AppleLocale").Output()
	if err != nil {
		return ""
	}
	loc := strings.TrimSpace(string(out))
	if i := strings.IndexAny(loc, "@"); i >= 0 {
		loc = loc[:i]
	}
	return strings.ReplaceAll(loc, "_", "-")
}

func BrowserLanguageForced() bool { return false }
func BrowserLanguages() string    { return "" }
func resyncClock() error          { return errUnsupported }
