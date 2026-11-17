package license

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestIsDefinitiveRejection(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"suspended account", &APIError{Status: 403, Code: "ACCOUNT_UNAVAILABLE"}, true},
		{"device revoked", &APIError{Status: 401, Code: "DEVICE_MISMATCH"}, true},
		{"refresh token invalid", &APIError{Status: 401, Code: "REFRESH_INVALID"}, true},
		{"refresh token replayed", &APIError{Status: 401, Code: "REFRESH_REPLAY"}, true},
		{"rate limited", &APIError{Status: 429, Code: "RATE_LIMITED"}, false},
		{"rate limited by a proxy reusing our code", &APIError{Status: 429, Code: "ACCOUNT_UNAVAILABLE"}, false},
		{"request timeout", &APIError{Status: 408, Code: "REFRESH_INVALID"}, false},
		{"too early", &APIError{Status: 425, Code: "REFRESH_INVALID"}, false},
		{"WAF HTML 403 without our code", &APIError{Status: 403}, false},
		{"proxy 404 without our code", &APIError{Status: 404}, false},
		{"bare 401 without our code", &APIError{Status: 401}, false},
		{"validation error", &APIError{Status: 400, Code: "VALIDATION_ERROR"}, false},
		{"expired access token", &APIError{Status: 401, Code: "ACCESS_INVALID"}, false},
		{"device slots full keeps the session", &APIError{Status: 409, Code: "DEVICE_LIMIT"}, false},
		{"server error carrying a code", &APIError{Status: 503, Code: "ACCOUNT_UNAVAILABLE"}, false},
		{"network error", errors.New("dial tcp: timeout"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		if got := isDefinitiveRejection(tc.err); got != tc.want {
			t.Errorf("%s: isDefinitiveRejection = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// transientRejections are answers a paying user's client can receive without
// the account being revoked: a shared-NAT rate limit, a WAF / captive-portal
// page, a proxy 404.
var transientRejections = []struct {
	name   string
	status int
	ctype  string
	body   string
}{
	{"rate limit", http.StatusTooManyRequests, "application/json", `{"error":{"code":"RATE_LIMITED","message":"操作过于频繁，请稍后再试"}}`},
	{"WAF 403 page", http.StatusForbidden, "text/html", `<html><body>Access denied</body></html>`},
	{"proxy 404 page", http.StatusNotFound, "text/html", `<html>not found</html>`},
	{"bare 401", http.StatusUnauthorized, "text/plain", `unauthorized`},
}

func rejectingServer(t *testing.T, status int, ctype, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server
}

func sessionClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	return &Client{
		path:   filepath.Join(t.TempDir(), "license.dat"),
		apiURL: server.URL,
		http:   server.Client(),
		state:  state{SchemaVersion: stateSchemaVersion, Username: "member", AccessToken: "access", RefreshToken: "refresh", DeviceID: "device", Lease: "lease"},
	}
}

func assertSessionAndLeaseKept(t *testing.T, name string, c *Client) {
	t.Helper()
	if c.state.AccessToken != "access" || c.state.RefreshToken != "refresh" || c.state.DeviceID != "device" || c.state.Lease != "lease" {
		t.Fatalf("%s: a transient answer destroyed the cached session or lease: %+v", name, c.state)
	}
}

func TestReconcileSessionKeepsStateOnTransientRejection(t *testing.T) {
	for _, tc := range transientRejections {
		c := sessionClient(t, rejectingServer(t, tc.status, tc.ctype, tc.body))
		if err := c.ReconcileSession(context.Background()); err == nil {
			t.Fatalf("%s: unexpectedly reconciled", tc.name)
		}
		assertSessionAndLeaseKept(t, tc.name, c)
	}
}

func TestEnsureEntitledKeepsStateOnTransientRejection(t *testing.T) {
	for _, tc := range transientRejections {
		c := sessionClient(t, rejectingServer(t, tc.status, tc.ctype, tc.body))
		_ = c.EnsureEntitled() // "lease" is not a verifiable lease; only the cached state matters here
		assertSessionAndLeaseKept(t, tc.name, c)
	}
}

func TestAuthedRequestKeepsStateWhenRefreshIsRateLimited(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/auth/refresh" {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"操作过于频繁，请稍后再试"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"ACCESS_INVALID","message":"Authentication required"}}`))
	}))
	defer server.Close()
	c := sessionClient(t, server)
	c.mu.Lock()
	err := c.authedRequestLocked(context.Background(), http.MethodGet, "/v1/me/orders", nil, nil)
	c.mu.Unlock()
	if err == nil {
		t.Fatal("request unexpectedly succeeded")
	}
	assertSessionAndLeaseKept(t, "rate-limited refresh", c)
}
