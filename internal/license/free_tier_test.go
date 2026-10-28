package license

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const freeLogin = `{"accessToken":"a","refreshToken":"r","deviceId":"dev-1","user":{"username":"neo","phoneBound":false},"license":{"plan":"免费版","planCode":"free","tier":"free","maxDevices":1,"features":["free"],"freeDevices":1,"planDevices":0}}`

func TestFreeTierAuthenticatesWithoutMembership(t *testing.T) {
	c := testServerClientLoginThenLease(t)
	if err := c.Login("neo", "password1"); err != nil {
		t.Fatal(err)
	}
	st := c.Status()
	if !st.Authenticated || st.Member || st.Tier != "free" {
		t.Fatalf("free account should be authenticated non-member: %+v", st)
	}
	if st.FreeDevices != 1 || st.PlanDevices != 0 || st.PhoneBound {
		t.Fatalf("free devices / phone flag not carried: %+v", st)
	}
}

// testServerClientLoginThenLease answers login with freeLogin and signs a
// free-tier lease.
func testServerClientLoginThenLease(t *testing.T) *Client {
	t.Helper()
	c, private := testClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(freeLogin))
		case "/v1/license/lease":
			fp := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
			lease := signedLease(t, private, map[string]any{"sub": "u", "did": "dev-1", "fph": hex.EncodeToString(fp[:]), "plan": "免费版", "planCode": "free", "tier": "free", "maxDevices": 1, "minVersion": "1.0.0", "exp": time.Now().Add(time.Hour).Unix(), "entitlementExp": time.Now().Add(24 * time.Hour).Unix(), "grace": 6, "iat": time.Now().Unix()})
			_ = json.NewEncoder(w).Encode(map[string]string{"lease": lease})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	c.apiURL, c.http = server.URL, server.Client()
	return c
}

func TestLeaseDeviceLimitShowsUnbindScreen(t *testing.T) {
	c, _ := testClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(freeLogin))
		case "/v1/license/lease":
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"DEVICE_LIMIT","message":"当前套餐设备名额已减少，请先解绑超额设备"}}`))
		}
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()
	if err := c.Login("neo", "password1"); err != nil {
		t.Fatalf("device-limit lease must keep the session, got %v", err)
	}
	st := c.Status()
	if !st.SignedIn || !st.DeviceLimitReached || st.Authenticated {
		t.Fatalf("expected signed-in pending device: %+v", st)
	}
}

func TestMemberTierAndPhoneDefaults(t *testing.T) {
	for tier, want := range map[string]bool{"": false, "free": false, "standard": true, "premium": true, "admin": true} {
		if got := isMemberTier(tier); got != want {
			t.Fatalf("isMemberTier(%q) = %v, want %v", tier, got, want)
		}
	}
	c, _ := testClient(t)
	if !c.Status().PhoneBound {
		t.Fatal("unknown phone state (old server / old cache) must not nag the user")
	}
}

func TestNormalizePhone(t *testing.T) {
	for raw, want := range map[string]string{"13800138000": "13800138000", "+86 138-0013-8000": "13800138000", "8613800138000": "13800138000"} {
		got, err := NormalizePhone(raw)
		if err != nil || got != want {
			t.Fatalf("NormalizePhone(%q) = %q, %v", raw, got, err)
		}
	}
	for _, bad := range []string{"", "12345", "23800138000", "1380013800a"} {
		if _, err := NormalizePhone(bad); err == nil {
			t.Fatalf("NormalizePhone(%q) accepted", bad)
		}
	}
}

func TestConfigSyncConflictMapsToErr(t *testing.T) {
	c, _ := testClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/me/config-sync" || r.Method != http.MethodPut {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var body struct {
			BaseVersion int `json:"baseVersion"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.BaseVersion != 3 {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"SYNC_CONFLICT","message":"conflict"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"version":4}`))
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()
	c.state.AccessToken = "a"
	if v, err := c.ConfigSyncPut("{}", 3); err != nil || v != 4 {
		t.Fatalf("put = %d, %v", v, err)
	}
	if _, err := c.ConfigSyncPut("{}", 1); err != ErrSyncConflict {
		t.Fatalf("stale base version should conflict, got %v", err)
	}
}
