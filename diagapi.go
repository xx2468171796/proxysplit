package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"proxysplit/internal/core"
)

// Diagnostics / test endpoints of the local control API (and the matching MCP
// tools), so an AI can inspect and verify routing on any machine.

func (a *App) registerDiagAPI(mux *http.ServeMux, auth func(func(http.ResponseWriter, *http.Request)) http.HandlerFunc, writeJSON func(http.ResponseWriter, int, any)) {
	// GET /api/diag — redacted state snapshot + core config + hints.
	mux.HandleFunc("/api/diag", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, a.diagSnapshot())
	}))
	// GET /api/diag/logs?n=300&grep=baidu
	mux.HandleFunc("/api/diag/logs", auth(func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		writeJSON(w, 200, a.svc.RecentLogs(n, r.URL.Query().Get("grep")))
	}))
	// POST /api/diag/route-test {"process":"chrome.exe","url":"https://www.baidu.com"}
	mux.HandleFunc("/api/diag/route-test", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Process string `json:"process"`
			URL     string `json:"url"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, a.svc.RouteTest(b.Process, b.URL))
	}))
	// POST /api/diag/selftest — listed + unlisted programs × mainland / foreign sites.
	mux.HandleFunc("/api/diag/selftest", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, tmSelfTestRun(a.svc.SelfTest))
	}))
	// GET /api/ai-hijack — 劫持模式状态（只读：恢复只能在软件界面里点）
	mux.HandleFunc("/api/ai-hijack", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, a.GetAIHijack())
	}))
	// GET /api/exits — AI 页实时出口：本机 / 分应用代理 / AI 线路（exits_app.go）
	mux.HandleFunc("/api/exits", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, a.GetExits())
	}))
	// GET /api/ai-env — AI 环境检测; POST /api/ai-env/fix {"id":"guard|timezone|clock|autostart|all"}
	mux.HandleFunc("/api/ai-env", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, a.CheckAIEnv())
	}))
	mux.HandleFunc("/api/ai-env/fix", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID string `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, okOr(a.FixAIEnv(b.ID)))
	}))
	// GET /api/custom-rules ; POST {"rules":[{"type":"suffix","value":"x.com","action":"proxy"}]}
	mux.HandleFunc("/api/custom-rules", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeJSON(w, 200, a.svc.GetCustomRules())
			return
		}
		var b struct {
			Rules []core.RouteRule `json:"rules"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeJSON(w, 400, map[string]string{"error": "body must be {\"rules\":[...]}"})
			return
		}
		writeJSON(w, 200, okOr(a.svc.SetCustomRules(b.Rules)))
	}))
	// POST /api/nodes/core {"id":"<node id>","core":"auto|sing-box|xray"}
	mux.HandleFunc("/api/nodes/core", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID   string `json:"id"`
			Core string `json:"core"`
		}
		if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&b) != nil || b.ID == "" {
			writeJSON(w, 400, map[string]string{"error": "POST {\"id\":\"<节点 id>\",\"core\":\"auto|sing-box|xray\"}"})
			return
		}
		writeJSON(w, 200, okOr(a.SetNodeCore(b.ID, b.Core)))
	}))
	// POST /api/split-mode {"mode":"whitelist|blacklist"}
	mux.HandleFunc("/api/split-mode", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Mode string `json:"mode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, okOr(a.svc.SetRuleMode(b.Mode)))
	}))
	// GET /api/account — login / membership state (ProxySplit account + POWER云).
	mux.HandleFunc("/api/account", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"license": a.GetLicenseStatus(), "powervpn": a.GetPowerVPNStatus()})
	}))
	// POST /api/account/login {"username","password"} — ProxySplit account login.
	mux.HandleFunc("/api/account/login", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Username) == "" || b.Password == "" {
			writeJSON(w, 400, map[string]string{"error": "username and password required"})
			return
		}
		writeJSON(w, 200, okOr(a.Login(strings.TrimSpace(b.Username), b.Password)))
	}))
	// GET /api/settings ; POST a partial object, e.g. {"tunMode":true,"blockQUIC":false}
	mux.HandleFunc("/api/settings", auth(func(w http.ResponseWriter, r *http.Request) {
		set := a.GetSettings()
		if r.Method == http.MethodGet {
			if set.LanPass != "" {
				set.LanPass = "***"
			}
			writeJSON(w, 200, set)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&set); err != nil { // overlays only the given fields
			writeJSON(w, 400, map[string]string{"error": "body must be a JSON object of settings fields"})
			return
		}
		writeJSON(w, 200, okOr(a.SetSettings(set)))
	}))
	// POST /api/nodes/add {"text":"<share links, one per line>"} ; POST /api/nodes/remove {"id"}
	mux.HandleFunc("/api/nodes/add", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, a.AddNodes(b.Text))
	}))
	mux.HandleFunc("/api/nodes/remove", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID string `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, okOr(a.RemoveNode(b.ID)))
	}))
	// POST /api/log-level {"level":"info|debug|warn"}
	mux.HandleFunc("/api/log-level", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Level string `json:"level"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, okOr(a.svc.SetLogLevel(b.Level)))
	}))
	// GET /api/reset — 清除与重置清单；POST {"items":["core-dns-cache",...],"confirm":"确认重置"}
	// 没有任何一项会解除 AI 劫持（解除只能在界面点「恢复」）。
	mux.HandleFunc("/api/reset", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeJSON(w, 200, a.GetResetCenter())
			return
		}
		var b struct {
			Items   []string `json:"items"`
			Confirm string   `json:"confirm"`
		}
		if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&b) != nil || len(b.Items) == 0 {
			writeJSON(w, 400, map[string]string{"error": "POST {\"items\":[\"<id>\",...],\"confirm\":\"恢复出厂时填 确认重置\"}"})
			return
		}
		writeJSON(w, 200, a.RunReset(b.Items, b.Confirm))
	}))
}

func okOr(msg string) map[string]any {
	if msg != "" {
		return map[string]any{"ok": false, "error": msg}
	}
	return map[string]any{"ok": true}
}

func (a *App) diagSnapshot() map[string]any {
	return map[string]any{"appVersion": appVersion, "diag": a.svc.Diagnose()}
}

func diagMCPTools() []map[string]any {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	empty := map[string]any{"type": "object", "properties": map[string]any{}}
	return []map[string]any{
		{"name": "proxysplit_diagnose", "description": "诊断快照：版本、运行状态、代理策略、分流模式、应用规则、自定义规则、节点(无密码)、实际生效的内核配置(脱敏)和常见问题提示。排查分流问题先调它。", "inputSchema": empty},
		{"name": "proxysplit_route_test", "description": "以指定程序名真实访问一个网址，返回走了哪条规则、从哪里出去(直连/节点/拦截)、是否成功。程序名填应用规则里的名字(如 chrome.exe)，不填=没列出的程序。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"process": str("程序文件名，如 chrome.exe；留空=未列出的程序"),
			"url":     str("完整网址，如 https://www.baidu.com"),
		}, "required": []string{"url"}}},
		{"name": "proxysplit_selftest", "description": "一键自检：列出的应用和未列出的程序分别访问百度/QQ/Google/YouTube，与当前设置应有的结果对比，标出不符合预期的项(需代理在运行，约 1 分钟)。", "inputSchema": empty},
		{"name": "proxysplit_logs", "description": "最近的日志行(含内核日志)，可按关键字过滤。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"n":    map[string]any{"type": "integer", "description": "行数，默认 300"},
			"grep": str("可选：只要包含该关键字的行"),
		}}},
		{"name": "proxysplit_set_custom_rules", "description": "整体替换自定义规则(代理策略为「规则」时生效)。rules 为数组，每项 {type: domain|suffix|keyword|ip, value, action: proxy|direct|block}。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"rules": map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
		}, "required": []string{"rules"}}},
		{"name": "proxysplit_account", "description": "登录与会员状态(ProxySplit 账号、POWER云)。", "inputSchema": empty},
		{"name": "proxysplit_set_settings", "description": "修改设置，只传要改的字段，如 {\"settings\":{\"tunMode\":true}}(tunMode=整机全局、blockQUIC、remoteDNS、privateDirect 等，字段名同 proxysplit_diagnose 里的 settings)。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"settings": map[string]any{"type": "object"},
		}, "required": []string{"settings"}}},
		{"name": "proxysplit_add_nodes", "description": "导入节点分享链接(每行一个)。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"text": str("分享链接，每行一个"),
		}, "required": []string{"text"}}},
		{"name": "proxysplit_set_split_mode", "description": "设置分流模式：whitelist=只代理列出的应用，blacklist=默认全走代理。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"mode": map[string]any{"type": "string", "enum": []string{"whitelist", "blacklist"}},
		}, "required": []string{"mode"}}},
	}
}

// diagMCPCall runs a diagnostics tool; ok=false when name is not one of them.
func (a *App) diagMCPCall(name string, args json.RawMessage) (string, bool) {
	j := func(v any) string { b, _ := json.MarshalIndent(v, "", " "); return string(b) }
	var m struct {
		Process  string           `json:"process"`
		URL      string           `json:"url"`
		N        int              `json:"n"`
		Grep     string           `json:"grep"`
		Rules    []core.RouteRule `json:"rules"`
		Mode     string           `json:"mode"`
		Text     string           `json:"text"`
		Settings json.RawMessage  `json:"settings"`
	}
	_ = json.Unmarshal(args, &m)
	switch name {
	case "proxysplit_account":
		return j(map[string]any{"license": a.GetLicenseStatus(), "powervpn": a.GetPowerVPNStatus()}), true
	case "proxysplit_set_settings":
		set := a.GetSettings()
		if err := json.Unmarshal(m.Settings, &set); err != nil {
			return "错误: settings 必须是对象", true
		}
		return j(okOr(a.SetSettings(set))), true
	case "proxysplit_add_nodes":
		return j(a.AddNodes(m.Text)), true
	case "proxysplit_diagnose":
		return j(a.diagSnapshot()), true
	case "proxysplit_route_test":
		return j(a.svc.RouteTest(m.Process, strings.TrimSpace(m.URL))), true
	case "proxysplit_selftest":
		return j(tmSelfTestRun(a.svc.SelfTest)), true
	case "proxysplit_logs":
		return strings.Join(a.svc.RecentLogs(m.N, m.Grep), "\n"), true
	case "proxysplit_set_custom_rules":
		return j(okOr(a.svc.SetCustomRules(m.Rules))), true
	case "proxysplit_set_split_mode":
		return j(okOr(a.svc.SetRuleMode(m.Mode))), true
	}
	return "", false
}
