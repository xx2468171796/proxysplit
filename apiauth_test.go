package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"proxysplit/internal/powervpn"
	"proxysplit/internal/service"
)

type controlFixture struct {
	app   *App
	srv   *httptest.Server
	token string
}

// newControlFixture serves the real control handler (guard included) for an
// App with an empty config.
func newControlFixture(t *testing.T) *controlFixture {
	t.Helper()
	dir := t.TempDir()
	svc, err := service.New(t.TempDir(), dir)
	if err != nil {
		t.Fatal(err)
	}
	a := &App{svc: svc, ready: make(chan struct{}), pv: powervpn.New(dir, appVersion)}
	close(a.ready)
	srv := httptest.NewServer(a.controlHandler())
	t.Cleanup(srv.Close)
	return &controlFixture{app: a, srv: srv, token: svc.APIToken()}
}

type controlCall struct {
	method, path, body string
	header             map[string]string // overrides; "" removes a default header
	host               string
}

// do sends a request the way a well-behaved client does (bearer token, JSON
// content type on POST) unless the call overrides it.
func (f *controlFixture) do(t *testing.T, c controlCall) (int, string) {
	t.Helper()
	req, err := http.NewRequest(c.method, f.srv.URL+c.path, strings.NewReader(c.body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+f.token)
	if c.method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range c.header {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	if c.host != "" {
		req.Host = c.host
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func TestControlAPIAuth(t *testing.T) {
	f := newControlFixture(t)
	cases := []struct {
		name string
		call controlCall
		want int
	}{
		{"bearer token", controlCall{method: "GET", path: "/api/status"}, 200},
		{"no token", controlCall{method: "GET", path: "/api/status", header: map[string]string{"Authorization": ""}}, 401},
		{"wrong token", controlCall{method: "GET", path: "/api/status", header: map[string]string{"Authorization": "Bearer " + strings.Repeat("0", len(f.token))}}, 401},
		{"token prefix", controlCall{method: "GET", path: "/api/status", header: map[string]string{"Authorization": "Bearer " + f.token[:len(f.token)-1]}}, 401},
		{"token without the Bearer scheme", controlCall{method: "GET", path: "/api/status", header: map[string]string{"Authorization": f.token}}, 401},
		// A token in the URL ends up in browser history, proxy logs and Referer.
		{"token in the query string", controlCall{method: "GET", path: "/api/status?token=" + f.token, header: map[string]string{"Authorization": ""}}, 401},
		// Our clients are curl / the MCP bridge; only a browser sends Origin.
		{"browser request", controlCall{method: "GET", path: "/api/status", header: map[string]string{"Origin": "https://evil.example"}}, 403},
		{"browser request from a local page", controlCall{method: "POST", path: "/api/stop", body: "{}", header: map[string]string{"Origin": "http://127.0.0.1:18088"}}, 403},
		// DNS rebinding: evil.example resolves to 127.0.0.1.
		{"rebound host name", controlCall{method: "GET", path: "/api/status", host: "evil.example:18088"}, 403},
		{"localhost host name", controlCall{method: "GET", path: "/api/status", host: "localhost:18088"}, 200},
		{"ipv6 loopback host", controlCall{method: "GET", path: "/api/status", host: "[::1]:18088"}, 200},
	}
	for _, tc := range cases {
		if got, body := f.do(t, tc.call); got != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, got, tc.want, strings.TrimSpace(body))
		}
	}
}

func TestControlAPIMutationsNeedJSONPost(t *testing.T) {
	f := newControlFixture(t)
	upsert := `{"match":"git.exe","line":"global"}`
	cases := []struct {
		name string
		call controlCall
		want int
	}{
		{"read by GET", controlCall{method: "GET", path: "/api/apps"}, 200},
		{"mutation by JSON POST", controlCall{method: "POST", path: "/api/apps", body: upsert}, 200},
		{"JSON with charset", controlCall{method: "POST", path: "/api/apps", body: upsert, header: map[string]string{"Content-Type": "application/json; charset=utf-8"}}, 200},
		{"mutation by GET", controlCall{method: "GET", path: "/api/mode"}, 405},
		{"mutation by GET with a body", controlCall{method: "GET", path: "/api/node/select", body: `{"id":"x"}`}, 405},
		{"read-only route by POST", controlCall{method: "POST", path: "/api/status", body: "{}"}, 405},
		{"other method", controlCall{method: "DELETE", path: "/api/apps"}, 405},
		// What an HTML form or a no-preflight fetch can send.
		{"form post", controlCall{method: "POST", path: "/api/apps", body: "match=git.exe", header: map[string]string{"Content-Type": "application/x-www-form-urlencoded"}}, 415},
		{"text post", controlCall{method: "POST", path: "/api/apps", body: upsert, header: map[string]string{"Content-Type": "text/plain"}}, 415},
		{"post without content type", controlCall{method: "POST", path: "/api/apps", body: upsert, header: map[string]string{"Content-Type": ""}}, 415},
		{"oversized body", controlCall{method: "POST", path: "/api/nodes/add", body: `{"text":"` + strings.Repeat("x", controlBodyLimit) + `"}`}, 413},
	}
	for _, tc := range cases {
		if got, body := f.do(t, tc.call); got != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, got, tc.want, strings.TrimSpace(body))
		}
	}
	if rules := f.app.svc.GetAppRules(); len(rules) != 1 || rules[0].Match != "git.exe" {
		t.Fatalf("only the two JSON POSTs may have changed the rules: %+v", rules)
	}
	// Every mutating route is refused by GET, whatever it is.
	for _, route := range f.app.controlRoutes() {
		if route.get != nil {
			continue
		}
		if got, _ := f.do(t, controlCall{method: "GET", path: route.path}); got != 405 {
			t.Errorf("GET %s: status %d, want 405", route.path, got)
		}
	}
}

func TestRegenerateControlTokenRevokesTheOldOne(t *testing.T) {
	f := newControlFixture(t)
	old := f.token
	info := f.app.RegenerateAIControlToken()
	if info.Token == "" || info.Token == old || !strings.Contains(info.Prompt, info.Token) || strings.Contains(info.Prompt, old) {
		t.Fatalf("token not rotated in the control info")
	}
	if got, _ := f.do(t, controlCall{method: "GET", path: "/api/status"}); got != 401 {
		t.Fatalf("old token still accepted: %d", got)
	}
	f.token = info.Token
	if got, _ := f.do(t, controlCall{method: "GET", path: "/api/status"}); got != 200 {
		t.Fatalf("new token rejected: %d", got)
	}
	// The --mcp bridge reads the token from config.json: it must be there.
	if again := f.app.svc.APIToken(); again != info.Token {
		t.Fatal("regenerated token was not stored")
	}
}

func TestControlServerHasTimeouts(t *testing.T) {
	srv := newControlServer(http.NotFoundHandler())
	if srv.ReadHeaderTimeout <= 0 || srv.ReadTimeout <= 0 || srv.WriteTimeout <= 0 || srv.IdleTimeout <= 0 || srv.MaxHeaderBytes <= 0 {
		t.Fatalf("control server without limits: %+v", srv)
	}
}

// The text the user copies for an AI must work against the guard as written.
func TestCopyPromptMatchesTheGuard(t *testing.T) {
	prompt := aiPrompt("http://127.0.0.1:18088", "tok")
	if strings.Contains(prompt, "?token=") {
		t.Fatal("prompt teaches the removed query-string token")
	}
	for _, line := range strings.Split(prompt, "\n") {
		if strings.HasPrefix(line, "curl ") && strings.Contains(line, "/api/") {
			if !strings.Contains(line, "Authorization: Bearer tok") {
				t.Errorf("example without the bearer header: %s", line)
			}
			if (strings.Contains(line, "-d ") || strings.Contains(line, "-X POST")) && !strings.Contains(line, "Content-Type: application/json") {
				t.Errorf("POST example without the JSON content type: %s", line)
			}
		}
	}
}
