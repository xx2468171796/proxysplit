package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// 代理站（AI 中转站的代理商子站 <slug>.claude.zygskins.cn）：从代理站下载的程序文件名带代理商标识，
//   proxysplit-ai-d-<slug>.exe            普通下载
//   proxysplit-ai-d-<slug>-<凭据43位>.exe  免登录下载（凭据同主站）
// 浏览器可能追加 " (1)"。认定后写进 <数据目录>/dealer，先到先得（之后改文件名、自动更新都不变），
// 登录 / 注册 / POWER云 同步时带给服务端，服务端据此记归属、算分成，并返回该代理商的客服微信。

const dealerPrefix = "proxysplit-ai-d-"

var (
	dealerSlugRe   = regexp.MustCompile(`^[a-z0-9-]{2,30}$`)
	dealerTicketRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	exeSuffixRe    = regexp.MustCompile(`(?i)(?: ?\(\d+\))?\.exe$`)
)

// validDealerSlug: 2–30 chars of [a-z0-9-] (same rule as the aigw side).
func validDealerSlug(s string) bool { return dealerSlugRe.MatchString(s) }

// parseDealerExe splits a dealer-site file name into slug and optional
// one-time ticket. Not a dealer name → "", "". A slug is at most 30 chars, so
// "<slug>-<43-char ticket>" (≥ 46 chars) never collides with a plain slug.
func parseDealerExe(exe string) (slug, ticket string) {
	base := filepath.Base(exe)
	loc := exeSuffixRe.FindStringIndex(base)
	if loc == nil || len(base) < len(dealerPrefix) || !strings.EqualFold(base[:len(dealerPrefix)], dealerPrefix) {
		return "", ""
	}
	if loc[0] < len(dealerPrefix) {
		return "", ""
	}
	rest := base[len(dealerPrefix):loc[0]]
	if n := len(rest); n >= 46 && rest[n-44] == '-' && dealerTicketRe.MatchString(rest[n-43:]) {
		if s := strings.ToLower(rest[:n-44]); validDealerSlug(s) {
			return s, rest[n-43:]
		}
		return "", ""
	}
	if s := strings.ToLower(rest); validDealerSlug(s) {
		return s, ""
	}
	return "", ""
}

func dealerFile() string { return filepath.Join(dataDir(), "dealer") }

// resolveDealer: the persisted marker wins; otherwise the executable name.
func resolveDealer(file, exe string) (slug string, persist bool) {
	if raw, err := os.ReadFile(file); err == nil {
		if s := strings.TrimSpace(string(raw)); validDealerSlug(s) {
			return s, false
		}
	}
	if s, _ := parseDealerExe(exe); s != "" {
		return s, true
	}
	return "", false
}

// dealerSlug returns (and persists on first sight) this device's dealer.
func dealerSlug() string {
	exe, _ := os.Executable()
	s, persist := resolveDealer(dealerFile(), exe)
	if persist {
		_ = os.MkdirAll(dataDir(), 0o755)
		_ = os.WriteFile(dealerFile(), []byte(s+"\n"), 0o644)
	}
	return s
}
