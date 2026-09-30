package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/license"
	"proxysplit/internal/service"
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

// aigwStartURL turns the POWER云 consent URL into the panel's "sign in with
// the AI site" entry that comes back to it afterwards. Opened by the app (not a
// web page), the request carries Sec-Fetch-Site: none, which the panel accepts;
// cross-site links stay blocked. Anything unexpected keeps the original URL.
func aigwStartURL(authorize string) string {
	u, err := url.Parse(authorize)
	if err != nil || u.Path != "/oauth/authorize" || u.Host == "" {
		return authorize
	}
	next := u.Path + "?" + u.RawQuery
	start := url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/api/auth/aigw/start", RawQuery: url.Values{"next": {next}}.Encode()}
	return start.String()
}

// aigwDefaultApps are pre-added for AI-site customers on their first POWER云
// login (only when the app list is empty): browsers for claude.ai / Google
// login, and the AI coding tools. They just press 启动.
func aigwDefaultApps() []service.AppRule {
	names := []string{"chrome.exe", "msedge.exe", "claude.exe", "codex.exe", "Code.exe", "Cursor.exe"}
	out := make([]service.AppRule, 0, len(names))
	for _, n := range names {
		out = append(out, service.AppRule{Match: n, Path: n, Line: service.LineRule, Enabled: true})
	}
	return out
}

// downloadTicketRe: the AI site names a signed-in customer's download
// proxysplit-ai-<one-time POWER云 ticket>.exe (browsers may append " (1)").
var downloadTicketRe = regexp.MustCompile(`^(?i:proxysplit-ai-)([A-Za-z0-9_-]{43})(?: ?\(\d+\))?(?i:\.exe)$`)

// downloadTicket returns the ticket in the executable's file name, or "".
func downloadTicket(exe string) string {
	if m := downloadTicketRe.FindStringSubmatch(filepath.Base(exe)); m != nil {
		return m[1]
	}
	return ""
}

func ticketFile() string { return filepath.Join(dataDir(), "download-ticket") }

func ticketHash(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// ticketTried: the ticket in this file name was already redeemed (or tried) on
// this device. Only its hash is kept.
func ticketTried(file, t string) bool {
	raw, err := os.ReadFile(file)
	return err == nil && strings.TrimSpace(string(raw)) == ticketHash(t)
}

// autoLoginFromDownload: 中转站客户从 AI 编程官网下载的程序文件名里带一次性凭据，第一次打开直接用它登录
// POWER云 + ProxySplit（节点、常用程序都加好），不用点登录、不用开浏览器。跑在 startup 里、第一次界面快照之前，
// 所以窗口一出来就是登录好的。已登录、试过这枚凭据、或没带凭据时什么都不做；失败只记日志，退回登录页的按钮。
func (a *App) autoLoginFromDownload(ctx context.Context) {
	exe, _ := os.Executable()
	t := downloadTicket(exe)
	if t == "" || a.lic == nil || !a.lic.Enabled() || a.lic.Status().SignedIn || a.pv == nil || a.pv.LoggedIn() || ticketTried(ticketFile(), t) {
		return
	}
	// Record before redeeming: the panel burns the ticket on first use, so a
	// crash or timeout mid-way must not make every later start retry it.
	_ = os.MkdirAll(dataDir(), 0o755)
	_ = os.WriteFile(ticketFile(), []byte(ticketHash(t)+"\n"), 0o600)
	c, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if err := a.pv.LoginWithTicket(c, t); err != nil {
		a.svc.LogLine("[中转站] 免登录下载凭据没用上（" + err.Error() + "），请点「用 AI 编程官网账号登录」")
		return
	}
	if msg := a.finishPowerVPNLogin(c, a.pv); msg != "" {
		a.svc.LogLine("[中转站] 自动登录：" + strings.TrimPrefix(msg, "NOTICE:"))
		return
	}
	a.svc.LogLine("[中转站] 已用 AI 编程官网的下载自动登录，节点和常用程序已加好")
}

// powervpnMembershipSync: AI-site customers' ProxySplit membership follows
// their POWER云 AI plan. Re-check shortly after start and every few hours so a
// renewal extends it and an expiry ends it without the user signing in again.
func (a *App) powervpnMembershipSync() {
	time.Sleep(20 * time.Second)
	for {
		a.syncPowerVPNMembership()
		time.Sleep(3 * time.Hour)
	}
}

func (a *App) syncPowerVPNMembership() {
	if a.lic == nil || !a.lic.Enabled() || !a.lic.Status().SignedIn || a.pv == nil || !a.pv.LoggedIn() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tok, err := a.pv.AccessToken(ctx)
	if err == nil {
		err = a.lic.SyncPowerVPN(ctx, tok)
	}
	if err != nil && a.ctx != nil {
		runtime.LogWarning(a.ctx, "POWER云 会员同步失败: "+err.Error())
	}
}
