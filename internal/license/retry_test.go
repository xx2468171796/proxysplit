package license

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateOrderDoesNotReplayOnServerFailure(t *testing.T) {
	var orders, refreshes int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/orders":
			orders++
			http.Error(w, `{"error":{"message":"temporary"}}`, http.StatusBadGateway)
		case "/v1/auth/refresh":
			refreshes++
			_ = json.NewEncoder(w).Encode(map[string]string{"accessToken": "new-access", "refreshToken": "new-refresh"})
		}
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		fingerprint: "fingerprint", state: state{AccessToken: "access", RefreshToken: "refresh"}}
	if _, err := c.CreateOrder("plan"); err == nil {
		t.Fatal("expected create order failure")
	}
	if orders != 1 || refreshes != 0 {
		t.Fatalf("non-auth failure was replayed: orders=%d refreshes=%d", orders, refreshes)
	}
}

func TestCreateOrderRefreshesAndRetriesOnlyOnUnauthorized(t *testing.T) {
	var orders, refreshes int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/orders":
			orders++
			if orders == 1 {
				http.Error(w, `{"error":{"message":"expired"}}`, http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(Order{OrderNo: "PS1"})
		case "/v1/auth/refresh":
			refreshes++
			_ = json.NewEncoder(w).Encode(map[string]string{"accessToken": "new-access", "refreshToken": "new-refresh"})
		}
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		fingerprint: "fingerprint", state: state{AccessToken: "access", RefreshToken: "refresh"}}
	order, err := c.CreateOrder("plan")
	if err != nil || order.OrderNo != "PS1" {
		t.Fatalf("retry after 401 failed: order=%+v err=%v", order, err)
	}
	if orders != 2 || refreshes != 1 {
		t.Fatalf("unexpected calls: orders=%d refreshes=%d", orders, refreshes)
	}
}
