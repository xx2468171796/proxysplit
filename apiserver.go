package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
)

// apiPort is the fixed loopback port for the AI-control HTTP API. Fixed (not
// random) so the prompt / MCP config the user copies stays valid across runs.
const apiPort = 18088

// AIControlInfo is handed to the frontend so it can show the endpoint + token
// and offer a one-click "copy prompt" for an AI agent.
type AIControlInfo struct {
	URL       string `json:"url"`
	Token     string `json:"token"`
	Prompt    string `json:"prompt"`
	MCPConfig string `json:"mcpConfig"`
	Running   bool   `json:"running"`
}

// GetAIControlInfo returns the local control-API endpoint, token, a ready-to-
// paste AI prompt, and an MCP server config snippet.
func (a *App) GetAIControlInfo() AIControlInfo {
	token := ""
	if a.svc != nil {
		token = a.svc.APIToken()
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
	return AIControlInfo{
		URL:       url,
		Token:     token,
		Prompt:    aiPrompt(url, token),
		MCPConfig: mcpConfig(),
		Running:   a.apiUp,
	}
}

// startAPIServer starts the loopback control API. Failure (e.g. port busy) is
// non-fatal — the app runs fine without it.
func (a *App) startAPIServer() {
	if a.svc == nil {
		return
	}
	token := a.svc.APIToken()
	mux := http.NewServeMux()

	writeJSON := func(w http.ResponseWriter, code int, v any) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	auth := func(h func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			t := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			if t == "" {
				t = r.URL.Query().Get("token")
			}
			if t == "" || t != token {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized (bad or missing token)"})
				return
			}
			h(w, r)
		}
	}

	// GET /api/status — running state, active node, strategy, rule counts.
	mux.HandleFunc("/api/status", auth(func(w http.ResponseWriter, r *http.Request) {
		st := a.svc.Status()
		writeJSON(w, 200, map[string]any{
			"running": st.CoreRunning || st.EngineRunning,
			"node":    st.NodeName,
			"nodeId":  st.SelectedID,
			"mode":    a.svc.GetClashMode(),
			"apps":    a.svc.GetAppRules(),
		})
	}))

	// GET /api/nodes — available nodes.
	mux.HandleFunc("/api/nodes", auth(func(w http.ResponseWriter, r *http.Request) {
		type nodeLite struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Type   string `json:"type"`
			Server string `json:"server"`
		}
		var out []nodeLite
		for _, n := range a.svc.Nodes() {
			out = append(out, nodeLite{ID: n.ID, Name: n.Name, Type: n.Type, Server: n.Server})
		}
		writeJSON(w, 200, out)
	}))

	// POST /api/node/select {"id":"..."}
	mux.HandleFunc("/api/node/select", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID string `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.ID) == "" {
			writeJSON(w, 400, map[string]string{"error": "id required"})
			return
		}
		if msg := a.svc.SelectNode(b.ID); msg != "" {
			writeJSON(w, 200, map[string]any{"ok": false, "error": msg})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	}))

	// GET /api/apps ; POST /api/apps upsert {"match","path","line","enabled"}
	mux.HandleFunc("/api/apps", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeJSON(w, 200, a.svc.GetAppRules())
			return
		}
		var b struct {
			Match   string `json:"match"`
			Path    string `json:"path"`
			Line    string `json:"line"`
			Node    string `json:"node"`
			Enabled *bool  `json:"enabled"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Match) == "" {
			writeJSON(w, 400, map[string]string{"error": "match required (e.g. chrome.exe)"})
			return
		}
		en := b.Enabled == nil || *b.Enabled
		a.svc.UpsertAppRule(b.Match, b.Path, b.Line, b.Node, en)
		writeJSON(w, 200, map[string]any{"ok": true, "apps": a.svc.GetAppRules()})
	}))

	// POST /api/apps/remove {"match":"..."}
	mux.HandleFunc("/api/apps/remove", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Match string `json:"match"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Match) == "" {
			writeJSON(w, 400, map[string]string{"error": "match required"})
			return
		}
		a.svc.RemoveAppRule(b.Match)
		writeJSON(w, 200, map[string]any{"ok": true, "apps": a.svc.GetAppRules()})
	}))

	// POST /api/mode {"clash":"rule|global|direct"}
	mux.HandleFunc("/api/mode", auth(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Clash string `json:"clash"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		switch b.Clash {
		case "rule", "global", "direct":
			if err := a.svc.SetClashMode(b.Clash); err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true, "mode": b.Clash})
		default:
			writeJSON(w, 400, map[string]string{"error": "clash must be rule|global|direct"})
		}
	}))

	// POST /api/start ; POST /api/stop
	mux.HandleFunc("/api/start", auth(func(w http.ResponseWriter, r *http.Request) {
		if err := a.startService(); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("/api/stop", auth(func(w http.ResponseWriter, r *http.Request) {
		a.svc.Stop()
		writeJSON(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("/api/restart", auth(func(w http.ResponseWriter, r *http.Request) {
		a.svc.Stop()
		if err := a.startService(); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	}))

	// POST /mcp — a real Model Context Protocol server (JSON-RPC 2.0 over HTTP)
	// so Claude Code / Codex can use ProxySplit as native MCP tools.
	mux.HandleFunc("/mcp", auth(func(w http.ResponseWriter, r *http.Request) {
		a.handleMCP(w, r)
	}))

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", apiPort))
	if err != nil {
		a.svc.LogLine(fmt.Sprintf("[api] 控制 API 未能监听 127.0.0.1:%d: %v", apiPort, err))
		return
	}
	a.apiUp = true
	a.svc.LogLine(fmt.Sprintf("[api] AI 控制 API 已就绪: http://127.0.0.1:%d", apiPort))
	go func() { _ = http.Serve(ln, mux) }()
}

// mcpTools is the tool catalog advertised over MCP.
func mcpTools() []map[string]any {
	strProp := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	return []map[string]any{
		{"name": "proxysplit_status", "description": "查看 ProxySplit 代理当前状态(是否运行、活动节点、策略、应用规则)。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "proxysplit_list_nodes", "description": "列出所有可用节点(含 id/名称)。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "proxysplit_select_node", "description": "选择活动节点。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": strProp("节点 id(来自 proxysplit_list_nodes)")}, "required": []string{"id"}}},
		{"name": "proxysplit_set_app", "description": "把某个程序设为走代理/直连/全局/拦截(会自动新增或更新规则)。可选 node 指定走哪个节点。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"match": strProp("程序名或完整路径,如 chrome.exe"),
			"line":  map[string]any{"type": "string", "enum": []string{"rule", "global", "direct", "block"}, "description": "rule=智能分流 / global=全走节点 / direct=直连 / block=拦截"},
			"path":  strProp("可选:程序完整路径"),
			"node":  strProp("可选:节点 id(来自 proxysplit_list_nodes);留空=活动节点"),
		}, "required": []string{"match", "line"}}},
		{"name": "proxysplit_remove_app", "description": "移除某程序的分流规则。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"match": strProp("程序名,如 chrome.exe")}, "required": []string{"match"}}},
		{"name": "proxysplit_set_mode", "description": "设置总代理策略。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"clash": map[string]any{"type": "string", "enum": []string{"rule", "global", "direct"}}}, "required": []string{"clash"}}},
		{"name": "proxysplit_start", "description": "启动代理。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "proxysplit_stop", "description": "停止代理。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	}
}

// handleMCP implements the minimal MCP JSON-RPC 2.0 methods over HTTP.
func (a *App) handleMCP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	reply := func(result any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	// notifications (no id) get an empty 200.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusOK)
		return
	}
	switch req.Method {
	case "initialize":
		reply(map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "proxysplit", "version": appVersion},
		})
	case "tools/list":
		reply(map[string]any{"tools": mcpTools()})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		_ = json.Unmarshal(req.Params, &p)
		text := a.mcpCall(p.Name, p.Arguments)
		reply(map[string]any{"content": []map[string]any{{"type": "text", "text": text}}})
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID,
			"error": map[string]any{"code": -32601, "message": "method not found: " + req.Method}})
	}
}

// mcpCall executes one tool and returns a human/AI-readable text result.
func (a *App) mcpCall(name string, args json.RawMessage) string {
	var m map[string]any
	_ = json.Unmarshal(args, &m)
	str := func(k string) string { s, _ := m[k].(string); return strings.TrimSpace(s) }
	j := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	switch name {
	case "proxysplit_status":
		st := a.svc.Status()
		return j(map[string]any{"running": st.CoreRunning || st.EngineRunning, "node": st.NodeName, "mode": a.svc.GetClashMode(), "apps": a.svc.GetAppRules()})
	case "proxysplit_list_nodes":
		return j(a.svc.Nodes())
	case "proxysplit_select_node":
		if str("id") == "" {
			return "错误: 需要 id"
		}
		if msg := a.svc.SelectNode(str("id")); msg != "" {
			return "已选择节点 " + str("id") + "，" + msg
		}
		return "已选择节点 " + str("id")
	case "proxysplit_set_app":
		if str("match") == "" {
			return "错误: 需要 match(程序名)"
		}
		line := str("line")
		a.svc.UpsertAppRule(str("match"), str("path"), line, str("node"), true)
		return fmt.Sprintf("已设置 %s => %s", str("match"), line)
	case "proxysplit_remove_app":
		a.svc.RemoveAppRule(str("match"))
		return "已移除 " + str("match")
	case "proxysplit_set_mode":
		if err := a.svc.SetClashMode(str("clash")); err != nil {
			return "错误: " + err.Error()
		}
		return "代理策略已设为 " + str("clash")
	case "proxysplit_start":
		if err := a.startService(); err != nil {
			return "启动失败: " + err.Error()
		}
		return "代理已启动"
	case "proxysplit_stop":
		a.svc.Stop()
		return "代理已停止"
	default:
		return "未知工具: " + name
	}
}

// aiPrompt is the ready-to-paste instruction for an AI agent, embedding the
// endpoint + token so the agent can drive ProxySplit via plain HTTP (curl).
func aiPrompt(url, token string) string {
	return fmt.Sprintf(`你现在可以控制我本机的「ProxySplit」应用级分流代理软件。它在 %s 提供本地 HTTP 控制 API，鉴权用请求头：Authorization: Bearer %s

用途：把我指定的程序设置为走代理 / 直连 / 全局，并启动或停止代理。所有请求用 curl 即可。

可用接口（都要带上面的鉴权头）：
1) 查看状态：GET %s/api/status
2) 列出节点：GET %s/api/nodes
3) 选择节点：POST %s/api/node/select  body {"id":"<节点id>"}
4) 列出应用规则：GET %s/api/apps
5) 让某程序走代理/改分流方式：POST %s/api/apps  body {"match":"chrome.exe","line":"rule"}
   - line 取值：rule=智能分流(大陆直连,境外走节点) / global=全走节点 / direct=直连 / block=拦截断网
   - 可选 "node"(节点 id,来自接口 2;留空=活动节点，用于让不同程序走不同节点)
   - 可选 "path"(完整路径)、"enabled"(true/false 暂停或启用)
6) 移除某程序：POST %s/api/apps/remove  body {"match":"chrome.exe"}
7) 设置总代理策略：POST %s/api/mode  body {"clash":"rule"}  (rule/global/direct)
8) 启动代理：POST %s/api/start    停止：POST %s/api/stop

示例（让 Chrome 走智能分流并启动）：
curl -s -H "Authorization: Bearer %s" -H "Content-Type: application/json" -d "{\"match\":\"chrome.exe\",\"line\":\"rule\"}" %s/api/apps
curl -s -H "Authorization: Bearer %s" -X POST %s/api/start

当我说「让某某程序走代理」时，你就用接口 5 把它加进去(默认 line=rule)，需要时先 /api/start。操作完调用 /api/status 汇报结果。`,
		url, token, url, url, url, url, url, url, url, url, url, token, url, token, url)
}

// mcpConfig returns a Claude-Code / Codex style MCP config snippet. It runs
// this executable with --mcp (stdio, see mcpbridge.go) rather than pointing at
// the HTTP /mcp endpoint, so the AI can still start and control ProxySplit
// when the app is not open. The bridge reads the token itself.
func mcpConfig() string {
	exe, _ := os.Executable()
	cmd, _ := json.Marshal(exe)
	return fmt.Sprintf(`{
  "mcpServers": {
    "proxysplit": {
      "type": "stdio",
      "command": %s,
      "args": ["%s"]
    }
  }
}`, cmd, mcpFlag)
}
