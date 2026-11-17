package telemetry

import (
	"strings"
	"testing"
)

// Line shapes below are the ones the app really writes: os.PathError text
// appended by s.log("[config] …: " + err.Error()), the core's
// "router: found process path: …", the per-minute "[conn] …" lines, the panic
// stack (forward slashes) and JSON payloads (doubled backslashes).
func TestSanitizeHomePaths(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"windows os error", `[config] 写回从备份恢复的主配置失败: open C:\Users\张伟\AppData\Roaming\proxysplit\proxysplit-data.json: Access is denied.`,
			`[config] 写回从备份恢复的主配置失败: open C:\Users\[user]\AppData\Roaming\proxysplit\proxysplit-data.json: Access is denied.`},
		{"windows name with space", `[加速] 还原 Claude Code 配置失败：open C:\Users\Zhang Wei\.claude\settings.json: The system cannot find the file specified.`,
			`[加速] 还原 Claude Code 配置失败：open C:\Users\[user]\.claude\settings.json: The system cannot find the file specified.`},
		{"windows two paths", `[capture] 下载 WinDivert 驱动失败: rename C:\Users\li.ming\AppData\Roaming\proxysplit\bin\WinDivert64.sys.tmp C:\Users\li.ming\AppData\Roaming\proxysplit\bin\WinDivert64.sys: Access is denied.`,
			`[capture] 下载 WinDivert 驱动失败: rename C:\Users\[user]\AppData\Roaming\proxysplit\bin\WinDivert64.sys.tmp C:\Users\[user]\AppData\Roaming\proxysplit\bin\WinDivert64.sys: Access is denied.`},
		{"core process path", `INFO[0012] router: found process path: C:\Users\Administrator\AppData\Local\Google\Chrome\Application\chrome.exe`,
			`INFO[0012] router: found process path: C:\Users\[user]\AppData\Local\Google\Chrome\Application\chrome.exe`},
		{"lower-case drive, forward slashes (panic stack)", "\td:/users/wang_fang/go/src/proxysplit/app.go:120 +0x1f",
			"\td:/users/[user]/go/src/proxysplit/app.go:120 +0x1f"},
		{"json-escaped", `{"exe":"C:\\Users\\陈 静\\Desktop\\tool.exe"}`, `{"exe":"C:\\Users\\[user]\\Desktop\\tool.exe"}`},
		{"path ends at the profile dir", `mkdir C:\Users\bob: Access is denied.`, `mkdir C:\Users\[user]: Access is denied.`},
		{"profile dir then plain words", `chdir C:\Users\bob failed`, `chdir C:\Users\[user] failed`},
		{"old windows profile root", `open C:\Documents and Settings\老王\x.ini: denied`, `open C:\Documents and Settings\[user]\x.ini: denied`},
		{"macos", `[store] open /Users/zhangwei/Library/Application Support/proxysplit/data.json: permission denied`,
			`[store] open /Users/[user]/Library/Application Support/proxysplit/data.json: permission denied`},
		{"macos quoted", `exec: "/Users/li ming/Applications/ProxySplit.app/Contents/MacOS/sing-box": file does not exist`,
			`exec: "/Users/[user]/Applications/ProxySplit.app/Contents/MacOS/sing-box": file does not exist`},
		{"linux", `open /home/alice/.config/proxysplit/data.json: no such file or directory`,
			`open /home/[user]/.config/proxysplit/data.json: no such file or directory`},
		{"git-bash style drive", `stat /c/Users/alice/AppData/x: no such file`, `stat /c/Users/[user]/AppData/x: no such file`},
		{"shared dirs carry no name", `open C:\Users\Public\Desktop\a.lnk and /Users/Shared/x`, `open C:\Users\Public\Desktop\a.lnk and /Users/Shared/x`},
		{"not a home path", `[conn] chrome.exe → 香港 01 → www.google.com:443 rule=geosite-google`, `[conn] chrome.exe → 香港 01 → www.google.com:443 rule=geosite-google`},
		{"program files untouched", `C:\Program Files\ProxySplit\bin\sing-box.exe exited`, `C:\Program Files\ProxySplit\bin\sing-box.exe exited`},
	}
	for _, c := range cases {
		if got := Sanitize(c.in); got != c.want {
			t.Errorf("%s:\n in   %s\n got  %s\n want %s", c.name, c.in, got, c.want)
		}
	}
}

func TestSanitizePhones(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"account log line", "[account] login 13812345678 failed: 密码不对", "[account] login 138******78 failed: 密码不对"},
		{"+86 prefix", "[account] 发送验证码 +8613812345678 失败", "[account] 发送验证码 +86138******78 失败"},
		{"86 prefix", "bind 8613912345678 ok", "bind 86139******78 ok"},
		{"two numbers one separator", "13812345678,13987654321", "138******78,139******21"},
		{"in json", `{"phone":"15912345678"}`, `{"phone":"159******78"}`},
		{"chinese text around", "手机号13812345678已注册", "手机号138******78已注册"},
		{"longer digit run is not a phone", "trace 1381234567890123 done", "trace 1381234567890123 done"},
		{"unix millis untouched", "t=1763456789012 ok", "t=1763456789012 ok"},
		{"ip and port untouched", "dial tcp 139.196.12.34:13812: timeout", "dial tcp 139.196.12.34:13812: timeout"},
		{"landline-like 12x untouched", "id 12812345678", "id 12812345678"},
	}
	for _, c := range cases {
		if got := Sanitize(c.in); got != c.want {
			t.Errorf("%s: Sanitize(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

// Events go through the same owner: error text and payload strings.
func TestSanitizeValueCoversPathsAndPhones(t *testing.T) {
	got := SanitizeMap(map[string]any{
		"exe":   `C:\Users\张伟\AppData\Local\app.exe`,
		"lines": []string{"[account] login 13812345678"},
	})
	text := got["exe"].(string) + got["lines"].([]string)[0]
	for _, leak := range []string{"张伟", "13812345678"} {
		if strings.Contains(text, leak) {
			t.Errorf("payload leaked %q: %v", leak, got)
		}
	}
}
