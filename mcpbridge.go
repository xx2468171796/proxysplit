package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// `proxysplit.exe --mcp` speaks MCP over stdio, so Claude Code / Codex can start
// it as a command-type MCP server and control ProxySplit even when the app is
// not open. initialize / tools/list are answered here (an AI session starting
// up never pops the app); a tools/call first makes sure the app is running —
// starting it with --background (tray only, no window) when it is not — and
// then forwards the request to the app's loopback /mcp endpoint.

const (
	bridgeReadyTimeout = 60 * time.Second // first launch extracts the core and checks the licence
	bridgePollEvery    = 300 * time.Millisecond
	bridgeMaxLine      = 8 << 20
)

type mcpBridge struct {
	apiURL       string                 // http://127.0.0.1:18088
	token        func() (string, error) // current control-API token
	launch       func() error           // start the app in the background
	client       *http.Client
	readyTimeout time.Duration
	pollEvery    time.Duration
}

func newMCPBridge() *mcpBridge {
	// Resolve the executable once: an auto-update renames the running file to
	// .old, and a later launch must start the new version at the original path.
	exe, _ := os.Executable()
	return &mcpBridge{
		apiURL: fmt.Sprintf("http://127.0.0.1:%d", apiPort),
		token:  readAPIToken,
		launch: func() error { return launchBackground(exe) },
		// loopback only: never send the token through a system / env proxy
		client:       &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{Proxy: nil}},
		readyTimeout: bridgeReadyTimeout,
		pollEvery:    bridgePollEvery,
	}
}

// runMCPBridge serves newline-delimited JSON-RPC on in/out until in closes.
func runMCPBridge(in io.Reader, out io.Writer) error {
	return newMCPBridge().serve(in, out)
}

func (b *mcpBridge) serve(in io.Reader, out io.Writer) error {
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 64<<10), bridgeMaxLine)
	w := bufio.NewWriter(out)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		resp := b.handle(line)
		if resp == nil {
			continue
		}
		if _, err := w.Write(append(resp, '\n')); err != nil {
			return err
		}
		if err := w.Flush(); err != nil {
			return err
		}
	}
	return sc.Err()
}

type rpcRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
}

// handle returns one response line, or nil for notifications.
func (b *mcpBridge) handle(line []byte) []byte {
	var req rpcRequest
	if err := json.Unmarshal(line, &req); err != nil {
		return rpcError(json.RawMessage("null"), -32700, "parse error: "+err.Error())
	}
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return nil
	}
	switch req.Method {
	case "initialize":
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "proxysplit", "version": appVersion},
			"instructions":    "ProxySplit 应用分流代理。本机访问境外资源(GitHub、npm、海外 API 等)慢、超时或连接被重置时，用 proxysplit_set_app 把对应程序(git.exe、curl.exe、node.exe…)设为 global 走节点；代理没运行就先 proxysplit_start。软件没打开也没关系：调用任何工具都会自动在后台启动它。",
		})
	case "ping":
		return rpcResult(req.ID, map[string]any{})
	case "tools/list":
		return rpcResult(req.ID, map[string]any{"tools": mcpTools()})
	case "tools/call":
		resp, err := b.forward(line)
		if err != nil {
			return rpcResult(req.ID, map[string]any{
				"content": []map[string]any{{"type": "text", "text": err.Error()}},
				"isError": true,
			})
		}
		return resp
	default:
		return rpcError(req.ID, -32601, "method not found: "+req.Method)
	}
}

// forward makes sure the app is up, then relays the request to its /mcp.
func (b *mcpBridge) forward(line []byte) ([]byte, error) {
	token, err := b.ensureRunning()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, b.apiURL+"/mcp", bytes.NewReader(line))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ProxySplit 控制接口请求失败：%w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, bridgeMaxLine))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ProxySplit 控制接口返回 %d：%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, body); err != nil {
		return nil, fmt.Errorf("ProxySplit 控制接口返回了无效 JSON：%w", err)
	}
	return compact.Bytes(), nil
}

// ensureRunning returns the control token once the app's API answers,
// launching the app in the background when it does not.
func (b *mcpBridge) ensureRunning() (string, error) {
	if token, ok := b.alive(); ok {
		return token, nil
	}
	if err := b.launch(); err != nil {
		return "", fmt.Errorf("无法启动 ProxySplit：%w", err)
	}
	deadline := time.Now().Add(b.readyTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(b.pollEvery)
		if token, ok := b.alive(); ok {
			return token, nil
		}
	}
	return "", fmt.Errorf("已在后台启动 ProxySplit，但 %d 秒内控制接口 %s 没有就绪（端口 %d 被占用，或程序在等待登录，请看 ProxySplit 窗口）", int(b.readyTimeout.Seconds()), b.apiURL, apiPort)
}

// alive reports whether the app's control API accepts the current token. The
// token is re-read every time: the first launch creates it.
func (b *mcpBridge) alive() (string, bool) {
	token, err := b.token()
	if err != nil || token == "" {
		return "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.apiURL+"/api/status", nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := b.client.Do(req)
	if err != nil {
		return "", false
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return token, resp.StatusCode == http.StatusOK
}

// readAPIToken reads the control-API token the app persisted in config.json.
func readAPIToken() (string, error) {
	data, err := os.ReadFile(filepath.Join(dataDir(), "config.json"))
	if err != nil {
		return "", err
	}
	var cfg struct {
		APIToken string `json:"apiToken"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "", err
	}
	if cfg.APIToken == "" {
		return "", errors.New("config.json has no apiToken yet")
	}
	return cfg.APIToken, nil
}

// launchBackground starts the app detached from the bridge (it must outlive
// the AI session and must not inherit the MCP stdio pipes).
func launchBackground(exe string) error {
	if exe == "" {
		return errors.New("找不到 ProxySplit 程序路径")
	}
	cmd := exec.Command(exe, backgroundFlag)
	cmd.SysProcAttr = detachedAttr()
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func rpcResult(id json.RawMessage, result any) []byte {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	return b
}

func rpcError(id json.RawMessage, code int, msg string) []byte {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}})
	return b
}
