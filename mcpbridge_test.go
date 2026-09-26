package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeApp stands in for the running ProxySplit control API.
type fakeApp struct {
	up       atomic.Bool
	token    string
	launches atomic.Int32
	calls    atomic.Int32
}

func (f *fakeApp) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !f.up.Load() {
			// app not running: behave like a closed port as far as the bridge can tell
			hj, _ := w.(http.Hijacker)
			conn, _, _ := hj.Hijack()
			conn.Close()
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+f.token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/status":
			_, _ = io.WriteString(w, `{"running":false}`)
		case "/mcp":
			f.calls.Add(1)
			body, _ := io.ReadAll(r.Body)
			var req struct {
				ID json.RawMessage `json:"id"`
			}
			_ = json.Unmarshal(body, &req)
			// the real endpoint answers pretty-printed JSON + newline
			_, _ = io.WriteString(w, "{\n \"jsonrpc\": \"2.0\", \"id\": "+string(req.ID)+",\n \"result\": {\"content\": [{\"type\": \"text\", \"text\": \"代理已启动\"}]}}\n")
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (f *fakeApp) bridge(url string, startsApp bool) *mcpBridge {
	return &mcpBridge{
		apiURL: url,
		token: func() (string, error) {
			if !f.up.Load() {
				return "", errors.New("no config yet")
			}
			return f.token, nil
		},
		launch: func() error {
			f.launches.Add(1)
			if startsApp {
				go func() { time.Sleep(50 * time.Millisecond); f.up.Store(true) }()
			}
			return nil
		},
		client:       &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}},
		readyTimeout: 500 * time.Millisecond,
		pollEvery:    10 * time.Millisecond,
	}
}

func runLines(t *testing.T, b *mcpBridge, lines ...string) []map[string]any {
	t.Helper()
	var out bytes.Buffer
	if err := b.serve(strings.NewReader(strings.Join(lines, "\n")+"\n"), &out); err != nil {
		t.Fatalf("serve: %v", err)
	}
	var resps []map[string]any
	for _, l := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if l == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			t.Fatalf("response line is not JSON: %q", l)
		}
		resps = append(resps, m)
	}
	return resps
}

func TestBridgeListsToolsWithoutLaunchingApp(t *testing.T) {
	f := &fakeApp{token: "tok"}
	b := f.bridge(f.server(t).URL, true)
	resps := runLines(t, b,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"ping"}`,
	)
	if len(resps) != 3 {
		t.Fatalf("want 3 responses (the notification gets none), got %d", len(resps))
	}
	tools := resps[1]["result"].(map[string]any)["tools"].([]any)
	if len(tools) != len(mcpTools()) {
		t.Fatalf("tools/list returned %d tools, want %d", len(tools), len(mcpTools()))
	}
	if n := f.launches.Load(); n != 0 {
		t.Fatalf("listing tools launched the app %d times", n)
	}
}

func TestBridgeLaunchesAppOnToolCall(t *testing.T) {
	f := &fakeApp{token: "tok"}
	b := f.bridge(f.server(t).URL, true)
	resps := runLines(t, b,
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"proxysplit_start","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"proxysplit_status","arguments":{}}}`,
	)
	if f.launches.Load() != 1 {
		t.Fatalf("want exactly one launch, got %d", f.launches.Load())
	}
	if f.calls.Load() != 2 {
		t.Fatalf("want both calls forwarded, got %d", f.calls.Load())
	}
	if id := resps[0]["id"].(float64); id != 7 {
		t.Fatalf("response id %v, want 7", id)
	}
	text := resps[0]["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"]
	if text != "代理已启动" {
		t.Fatalf("forwarded text %q", text)
	}
}

func TestBridgeReportsAppThatNeverComesUp(t *testing.T) {
	f := &fakeApp{token: "tok"}
	b := f.bridge(f.server(t).URL, false)
	resps := runLines(t, b, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"proxysplit_status"}}`)
	res := resps[0]["result"].(map[string]any)
	if res["isError"] != true {
		t.Fatalf("want isError result, got %v", res)
	}
	if text := res["content"].([]any)[0].(map[string]any)["text"].(string); !strings.Contains(text, "没有就绪") {
		t.Fatalf("unexpected error text %q", text)
	}
}

func TestBridgeRejectsUnknownMethodAndBadJSON(t *testing.T) {
	f := &fakeApp{token: "tok"}
	b := f.bridge(f.server(t).URL, true)
	resps := runLines(t, b, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`, `{not json`)
	if code := resps[0]["error"].(map[string]any)["code"].(float64); code != -32601 {
		t.Fatalf("unknown method code %v", code)
	}
	if code := resps[1]["error"].(map[string]any)["code"].(float64); code != -32700 {
		t.Fatalf("parse error code %v", code)
	}
}

func TestHasFlag(t *testing.T) {
	if !hasFlag([]string{"--updated", "--MCP"}, mcpFlag) || hasFlag([]string{"--mcpx"}, mcpFlag) {
		t.Fatal("hasFlag")
	}
}
