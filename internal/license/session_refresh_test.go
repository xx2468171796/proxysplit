package license

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// fakeAccessToken builds an unsigned JWT-shaped access token: the client only
// reads iat / exp from it, the server is the one that verifies it.
func fakeAccessToken(lifetime time.Duration) string {
	now := time.Now().Unix()
	payload, _ := json.Marshal(map[string]any{"typ": "access", "iat": now, "exp": now + int64(lifetime/time.Second)})
	return "h." + base64.RawURLEncoding.EncodeToString(payload) + ".s"
}

type entitlementServer struct {
	refreshes, leases atomic.Int32
	leaseStatus       atomic.Int32 // non-zero: answer the next lease calls with this status
	leaseCode         atomic.Value // error code sent with leaseStatus
	expireAccessOnce  atomic.Bool  // the next lease call answers 401 ACCESS_INVALID
}

// entitledClient is a signed-in client holding a valid lease, talking to a
// server that counts refresh and lease calls.
func entitledClient(t *testing.T) (*Client, *entitlementServer) {
	t.Helper()
	c, private := testClient(t)
	fp := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
	lease := func() string {
		return signedLease(t, private, map[string]any{"sub": "user", "did": "device", "fph": hex.EncodeToString(fp[:]), "plan": "Professional", "features": []string{"proxy"}, "minVersion": "1.8.0", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "entitlementExp": time.Now().Add(48 * time.Hour).Unix(), "grace": 6})
	}
	es := &entitlementServer{}
	es.leaseCode.Store("")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/auth/refresh":
			es.refreshes.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"accessToken": fakeAccessToken(15 * time.Minute), "refreshToken": "rotated"})
		case "/v1/license/lease":
			es.leases.Add(1)
			if es.expireAccessOnce.Swap(false) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"ACCESS_INVALID","message":"Authentication required"}}`))
				return
			}
			if status := int(es.leaseStatus.Load()); status != 0 {
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": es.leaseCode.Load(), "message": "rejected"}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"lease": lease()})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)
	c.apiURL, c.http = server.URL, server.Client()
	c.state = state{SchemaVersion: stateSchemaVersion, Username: "member", AccessToken: fakeAccessToken(15 * time.Minute), RefreshToken: "refresh", DeviceID: "device", Lease: lease(), SessionValidatedAt: time.Now().Unix()}
	return c, es
}

// The minute watchdog must not rotate the refresh token on every tick: a
// healthy client refreshes about once per access-token lifetime.
func TestEnsureEntitledDoesNotRefreshWhileAccessTokenIsFresh(t *testing.T) {
	c, es := entitledClient(t)
	for i := 0; i < 5; i++ {
		if err := c.EnsureEntitled(); err != nil {
			t.Fatalf("tick %d: %v", i, err)
		}
	}
	if got := es.refreshes.Load(); got != 0 {
		t.Fatalf("fresh access token was refreshed %d times in 5 ticks", got)
	}
	// Every tick still asks the server for a lease, so a suspension or an
	// unbound device is noticed within one tick.
	if got := es.leases.Load(); got != 5 {
		t.Fatalf("lease calls = %d, want 5", got)
	}
}

func TestEnsureEntitledRefreshesOnceNearAccessTokenExpiry(t *testing.T) {
	c, es := entitledClient(t)
	c.state.SessionValidatedAt = time.Now().Add(-14 * time.Minute).Unix() // 15-minute token, 1 minute left
	for i := 0; i < 3; i++ {
		if err := c.EnsureEntitled(); err != nil {
			t.Fatalf("tick %d: %v", i, err)
		}
	}
	if got := es.refreshes.Load(); got != 1 {
		t.Fatalf("refresh calls = %d, want exactly 1", got)
	}
	if c.state.RefreshToken != "rotated" {
		t.Fatalf("rotated refresh token was not stored: %q", c.state.RefreshToken)
	}
}

func TestEnsureEntitledRefreshesWhenTokenAgeIsUnknown(t *testing.T) {
	for name, mutate := range map[string]func(*Client){
		"unreadable token":       func(c *Client) { c.state.AccessToken = "opaque" },
		"no local issue time":    func(c *Client) { c.state.SessionValidatedAt = 0 },
		"clock set back":         func(c *Client) { c.state.SessionValidatedAt = time.Now().Add(time.Hour).Unix() },
		"access token missing":   func(c *Client) { c.state.AccessToken = "" },
		"token without lifetime": func(c *Client) { c.state.AccessToken = fakeAccessToken(0) },
	} {
		c, es := entitledClient(t)
		mutate(c)
		if err := c.EnsureEntitled(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := es.refreshes.Load(); got != 1 {
			t.Fatalf("%s: refresh calls = %d, want 1", name, got)
		}
	}
}

// The local clock can disagree with the server: when the server says the
// access token is no longer valid, refresh once and retry the lease.
func TestEnsureEntitledRefreshesWhenServerRejectsAccessToken(t *testing.T) {
	c, es := entitledClient(t)
	es.expireAccessOnce.Store(true)
	if err := c.EnsureEntitled(); err != nil {
		t.Fatal(err)
	}
	if es.refreshes.Load() != 1 || es.leases.Load() != 2 {
		t.Fatalf("refreshes = %d, leases = %d; want 1 and 2", es.refreshes.Load(), es.leases.Load())
	}
}

// Skipping the refresh must not delay revocation: the lease call alone
// reports a suspended account, with no refresh round-trip.
func TestEnsureEntitledDetectsRevocationWithoutRefreshing(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{http.StatusForbidden, "ACCOUNT_UNAVAILABLE"}, {http.StatusUnauthorized, "DEVICE_MISMATCH"}} {
		c, es := entitledClient(t)
		es.leaseCode.Store(tc.code)
		es.leaseStatus.Store(int32(tc.status))
		if err := c.EnsureEntitled(); !isDefinitiveRejection(err) {
			t.Fatalf("%s: got %v, want a definitive rejection", tc.code, err)
		}
		if c.state.Lease != "" {
			t.Fatalf("%s: lease survived a definitive rejection", tc.code)
		}
		if got := es.refreshes.Load(); got != 0 {
			t.Fatalf("%s: refresh calls = %d, want 0", tc.code, got)
		}
	}
}
