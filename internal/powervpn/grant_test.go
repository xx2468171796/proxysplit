package powervpn

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Only the OAuth error "invalid_grant" means the stored grant is dead. Any
// other 400 / 401 from the token endpoint (a WAF page, a rate limit, a panel
// bug, a wrong client id during a deploy) must not sign the user out.
func TestRefreshForgetsGrantOnlyOnInvalidGrant(t *testing.T) {
	cases := []struct {
		name   string
		status int
		ctype  string
		body   string
		forget bool
	}{
		{"invalid_grant", 400, "application/json", `{"error":"invalid_grant","error_description":"refresh token 已失效"}`, true},
		{"invalid_grant with 401", 401, "application/json", `{"error":"invalid_grant"}`, true},
		{"invalid_request", 400, "application/json", `{"error":"invalid_request","error_description":"missing parameter"}`, false},
		{"invalid_client", 401, "application/json", `{"error":"invalid_client"}`, false},
		{"temporarily_unavailable", 400, "application/json", `{"error":"temporarily_unavailable"}`, false},
		{"bare 400", 400, "text/plain", ``, false},
		{"WAF page", 401, "text/html", `<html><body>Access denied</body></html>`, false},
		{"panel error envelope", 400, "application/json", `{"error":{"message":"bad request"}}`, false},
		{"rate limit", 429, "application/json", `{"error":"invalid_grant"}`, false},
		{"server error", 502, "text/html", `<html>bad gateway</html>`, false},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", tc.ctype)
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		c := testClient(t, srv, newSigner(t))
		_ = c.setToken(&Token{AccessToken: "at1", RefreshToken: "rt1", Username: "ai0782", ExpiresAt: time.Now()})
		_, err := c.AccessToken(context.Background())
		srv.Close()
		if err == nil {
			t.Fatalf("%s: refresh unexpectedly succeeded", tc.name)
		}
		if got := errors.Is(err, errGrantRejected); got != tc.forget {
			t.Errorf("%s: grant rejected = %v, want %v (%v)", tc.name, got, tc.forget, err)
		}
		if got := !c.LoggedIn(); got != tc.forget {
			t.Errorf("%s: grant forgotten = %v, want %v", tc.name, got, tc.forget)
		}
	}
}
