package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeApp stands in for the running ProxySplit control API.
type fakeApp struct {
	up       atomic.Bool
	token    string
	nonce    string // "" = the listener cannot prove it is the app
	launches atomic.Int32
	calls    atomic.Int32
	tokens   atomic.Int32 // requests that carried the control token
	port     int
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
		if r.Header.Get("Authorization") != "" {
			f.tokens.Add(1)
		}
		if r.URL.Path == "/api/hello" {
			_ = json.NewEncoder(w).Encode(map[string]string{"app": "proxysplit", "proof": helloProof(f.nonce, r.URL.Query().Get("challenge"))})
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
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	f.port, _ = strconv.Atoi(port)
	t.Cleanup(srv.Close)
	return srv
}

func (f *fakeApp) bridge(startsApp bool) *mcpBridge {
	return &mcpBridge{
		endpoint: func() (controlEndpoint, error) {
			if !f.up.Load() {
				return controlEndpoint{}, errors.New("app not running: nothing published")
			}
			return controlEndpoint{Port: f.port, PID: os.Getpid(), Nonce: "the-published-nonce-0123456789abcdef"}, nil
		},
		pidAlive: processAlive,
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
	f := &fakeApp{token: "tok", nonce: "the-published-nonce-0123456789abcdef"}
	f.server(t)
	b := f.bridge(true)
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
	f := &fakeApp{token: "tok", nonce: "the-published-nonce-0123456789abcdef"}
	f.server(t)
	b := f.bridge(true)
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
	f := &fakeApp{token: "tok", nonce: "the-published-nonce-0123456789abcdef"}
	f.server(t)
	b := f.bridge(false)
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
	f := &fakeApp{token: "tok", nonce: "the-published-nonce-0123456789abcdef"}
	f.server(t)
	b := f.bridge(true)
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

// The control port is fixed: any local program can listen on it while the app
// is not running. The bridge must not hand the control token to a listener
// that has not proved it is the app.
func TestBridgeNeverSendsTokenToUnverifiedListener(t *testing.T) {
	published := "the-published-nonce-0123456789abcdef"
	cases := []struct {
		name     string
		nonce    string // what the listener knows
		endpoint func(f *fakeApp) (controlEndpoint, error)
	}{
		{"nothing published (app never started its listener)", published, func(*fakeApp) (controlEndpoint, error) {
			return controlEndpoint{}, errors.New("no control-api.json")
		}},
		{"published by a process that is gone", published, func(f *fakeApp) (controlEndpoint, error) {
			return controlEndpoint{Port: f.port, PID: deadPID(t), Nonce: published}, nil
		}},
		{"listener does not know the nonce", "", func(f *fakeApp) (controlEndpoint, error) {
			return controlEndpoint{Port: f.port, PID: os.Getpid(), Nonce: published}, nil
		}},
		{"listener knows another nonce", "an-older-nonce-0123456789abcdef-old", func(f *fakeApp) (controlEndpoint, error) {
			return controlEndpoint{Port: f.port, PID: os.Getpid(), Nonce: published}, nil
		}},
	}
	for _, tc := range cases {
		f := &fakeApp{token: "tok", nonce: tc.nonce}
		f.server(t)
		f.up.Store(true) // something is listening on the port and would accept the token
		b := f.bridge(false)
		b.endpoint = func() (controlEndpoint, error) { return tc.endpoint(f) }
		resps := runLines(t, b, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"proxysplit_status"}}`)
		if res := resps[0]["result"].(map[string]any); res["isError"] != true {
			t.Errorf("%s: the call went through: %v", tc.name, res)
		}
		if n := f.tokens.Load(); n != 0 {
			t.Errorf("%s: the control token was sent %d times to an unverified listener", tc.name, n)
		}
		if f.calls.Load() != 0 {
			t.Errorf("%s: the tool call was forwarded", tc.name)
		}
	}
}

// deadPID returns the pid of a process that has already exited.
func deadPID(t *testing.T) int {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	return cmd.Process.Pid
}

func TestProcessAlive(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Fatal("this process is reported dead")
	}
	if processAlive(deadPID(t)) {
		t.Fatal("an exited process is reported alive")
	}
	if processAlive(0) || processAlive(-1) {
		t.Fatal("an invalid pid is reported alive")
	}
}

func TestControlEndpointPublishAndRead(t *testing.T) {
	dir := t.TempDir()
	if _, err := readControlEndpoint(dir); err == nil {
		t.Fatal("read an endpoint that was never published")
	}
	first, err := publishControlEndpoint(dir, 18088)
	if err != nil {
		t.Fatal(err)
	}
	got, err := readControlEndpoint(dir)
	if err != nil || got != first || got.PID != os.Getpid() || got.Port != 18088 || len(got.Nonce) != 64 {
		t.Fatalf("published %+v, read %+v (%v)", first, got, err)
	}
	second, _ := publishControlEndpoint(dir, 18088)
	if second.Nonce == first.Nonce {
		t.Fatal("the nonce is not fresh on every start")
	}
	retractControlEndpoint(dir)
	if _, err := readControlEndpoint(dir); err == nil {
		t.Fatal("endpoint still readable after retract")
	}
	if err := os.WriteFile(controlEndpointPath(dir), []byte(`{"port":18088,"pid":1,"nonce":"short"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readControlEndpoint(dir); err == nil {
		t.Fatal("an incomplete endpoint file was accepted")
	}
}

// The real control handler answers the bridge's challenge without a token and
// gives nothing else away on that path.
func TestHelloProvesTheNonceWithoutAToken(t *testing.T) {
	f := newControlFixture(t)
	f.app.apiNonce = "the-published-nonce-0123456789abcdef"
	challenge := strings.Repeat("ab", 16)
	noToken := map[string]string{"Authorization": ""}
	status, body := f.do(t, controlCall{method: "GET", path: "/api/hello?challenge=" + challenge, header: noToken})
	var answer map[string]string
	_ = json.Unmarshal([]byte(body), &answer)
	if status != 200 || !helloProofValid(f.app.apiNonce, challenge, answer["proof"]) {
		t.Fatalf("hello: %d %s", status, body)
	}
	if strings.Contains(body, f.app.apiNonce) || strings.Contains(body, f.token) {
		t.Fatalf("hello reveals the nonce or the token: %s", body)
	}
	for name, call := range map[string]controlCall{
		"no challenge":    {method: "GET", path: "/api/hello", header: noToken},
		"short challenge": {method: "GET", path: "/api/hello?challenge=abcd", header: noToken},
		"not hex":         {method: "GET", path: "/api/hello?challenge=" + strings.Repeat("zz", 16), header: noToken},
	} {
		if status, _ := f.do(t, call); status != 400 {
			t.Errorf("%s: status %d, want 400", name, status)
		}
	}
	if status, _ := f.do(t, controlCall{method: "GET", path: "/api/hello?challenge=" + challenge, header: map[string]string{"Authorization": "", "Origin": "https://evil.example"}}); status != 403 {
		t.Errorf("browser request to hello: status %d, want 403", status)
	}
	// Only hello is open: every other route still needs the token.
	for _, route := range f.app.controlRoutes() {
		if route.open != (route.path == "/api/hello") {
			t.Errorf("%s: open = %v", route.path, route.open)
		}
	}
	// Before the listener is published there is no nonce to prove.
	f.app.apiNonce = ""
	if status, _ := f.do(t, controlCall{method: "GET", path: "/api/hello?challenge=" + challenge, header: noToken}); status != 400 {
		t.Errorf("hello without a nonce: status %d, want 400", status)
	}
}
