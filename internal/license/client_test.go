package license

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func signedLease(t *testing.T, private ed25519.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]any{"alg": "EdDSA", "kid": "proxysplit-license-v1"})
	payload, _ := json.Marshal(claims)
	message := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	signature := ed25519.Sign(private, []byte(message))
	return message + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func testClient(t *testing.T) (*Client, ed25519.PrivateKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	oldURL, oldKey := APIURL, PublicKeyBase64
	APIURL, PublicKeyBase64 = "https://license.invalid", base64.StdEncoding.EncodeToString(der)
	t.Cleanup(func() { APIURL, PublicKeyBase64 = oldURL, oldKey })
	return New(t.TempDir(), "1.9.0"), private
}

func TestLeaseVerificationAndOfflineGrace(t *testing.T) {
	c, private := testClient(t)
	exp := time.Now().Add(-time.Hour).Unix()
	entitlementExp := time.Now().Add(2 * time.Hour).Unix()
	fp := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
	c.state.DeviceID = "device"
	c.state.Lease = signedLease(t, private, map[string]any{"sub": "user", "did": "device", "fph": hex.EncodeToString(fp[:]), "plan": "Professional", "features": []string{"proxy"}, "minVersion": "1.8.0", "exp": exp, "entitlementExp": entitlementExp, "grace": 6})
	status := c.Status()
	if !status.Authenticated || status.Plan != "Professional" {
		t.Fatalf("valid offline lease rejected: %+v", status)
	}
	if got, want := status.ExpiresAt, time.Unix(entitlementExp, 0).Format(time.RFC3339); got != want {
		t.Fatalf("membership expiry mismatch: got %q want %q", got, want)
	}
	c.state.Lease = signedLease(t, private, map[string]any{"sub": "user", "did": "device", "fph": hex.EncodeToString(fp[:]), "minVersion": "2.0.0", "exp": time.Now().Add(time.Hour).Unix(), "entitlementExp": time.Now().Add(2 * time.Hour).Unix(), "grace": 6})
	if _, err := c.verifyLease(c.state.Lease); err == nil {
		t.Fatal("minimum-version policy was not enforced")
	}
}

func TestLeaseTamperRejected(t *testing.T) {
	c, private := testClient(t)
	token := signedLease(t, private, map[string]any{"minVersion": "1.8.0", "exp": time.Now().Add(time.Hour).Unix(), "grace": 72})
	parts := []byte(token)
	parts[len(parts)-1] ^= 1
	if _, err := c.verifyLease(string(parts)); err == nil {
		t.Fatal("tampered lease signature accepted")
	}
}

func TestPublicKeyParserAcceptsDERAndPEM(t *testing.T) {
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	for name, raw := range map[string][]byte{"der": der, "pem": pemBytes} {
		t.Run(name, func(t *testing.T) {
			got := parsePublicKey(base64.StdEncoding.EncodeToString(raw))
			if !got.Equal(public) {
				t.Fatalf("%s public key was not parsed", name)
			}
		})
	}
}

func TestProtectedStateRoundTrip(t *testing.T) {
	raw := []byte(`{"refreshToken":"secret"}`)
	sealed, err := protect(raw)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := unprotect(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != string(raw) {
		t.Fatalf("round-trip mismatch: %q", plain)
	}
}

func TestClearOnlineSessionPreservesOfflineLease(t *testing.T) {
	c, _ := testClient(t)
	c.state = state{
		Username:      "member",
		AccessToken:   "expired-access",
		RefreshToken:  "revoked-refresh",
		DeviceID:      "old-device",
		PendingDevice: true,
		Lease:         "signed-offline-lease",
		Plan:          "Standard",
		MaxDevices:    3,
	}

	c.clearOnlineSessionLocked()

	if c.state.AccessToken != "" || c.state.RefreshToken != "" || c.state.DeviceID != "" || c.state.PendingDevice {
		t.Fatalf("stale online session was not cleared: %+v", c.state)
	}
	if c.state.Lease != "signed-offline-lease" || c.state.Username != "member" || c.state.Plan != "Standard" || c.state.MaxDevices != 3 {
		t.Fatalf("offline entitlement metadata was unexpectedly cleared: %+v", c.state)
	}
}

func TestLoadMigratesLegacyStateAndPersistsVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "license.dat")
	legacy, err := json.Marshal(state{Username: "legacy-user", RefreshToken: "legacy-refresh", Lease: "offline-lease"})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := protect(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, sealed, 0o600); err != nil {
		t.Fatal(err)
	}

	c := &Client{path: path}
	c.load()
	if c.state.SchemaVersion != stateSchemaVersion || c.state.Username != "legacy-user" || c.state.Lease != "offline-lease" {
		t.Fatalf("legacy cache migration failed: %+v", c.state)
	}

	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := unprotect(persisted)
	if err != nil {
		t.Fatal(err)
	}
	var migrated state
	if err := json.Unmarshal(plain, &migrated); err != nil {
		t.Fatal(err)
	}
	if migrated.SchemaVersion != stateSchemaVersion {
		t.Fatalf("migrated schema version was not persisted: %+v", migrated)
	}
}

func TestLoadPreservesUnsupportedFutureStateForNewerClient(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "license.dat")
	future, err := json.Marshal(state{SchemaVersion: stateSchemaVersion + 1, Username: "future-user", RefreshToken: "future-refresh"})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := protect(future)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, sealed, 0o600); err != nil {
		t.Fatal(err)
	}

	c := &Client{path: path}
	c.load()
	if c.state.Username != "" {
		t.Fatalf("older client loaded unsupported future cache: %+v", c.state)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(sealed) {
		t.Fatal("older client modified a future-version cache")
	}
}

func TestReconcileSessionClearsRejectedSessionButKeepsLease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/auth/refresh" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"session revoked"}}`))
	}))
	defer server.Close()

	c := &Client{
		path:   filepath.Join(t.TempDir(), "license.dat"),
		apiURL: server.URL,
		http:   server.Client(),
		state: state{
			SchemaVersion:      stateSchemaVersion,
			Username:           "member",
			AccessToken:        "expired",
			RefreshToken:       "revoked",
			DeviceID:           "old-device",
			Lease:              "signed-offline-lease",
			SessionValidatedAt: time.Now().Add(-time.Hour).Unix(),
		},
	}

	err := c.ReconcileSession(context.Background())
	if err == nil {
		t.Fatal("rejected refresh unexpectedly succeeded")
	}
	if c.state.AccessToken != "" || c.state.RefreshToken != "" || c.state.DeviceID != "" || c.state.SessionValidatedAt != 0 {
		t.Fatalf("rejected online session was not cleared: %+v", c.state)
	}
	if c.state.Lease != "signed-offline-lease" || c.state.Username != "member" {
		t.Fatalf("offline entitlement was cleared: %+v", c.state)
	}
}

func TestReconcileSessionKeepsCacheOnNetworkFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	c := &Client{
		path:   filepath.Join(t.TempDir(), "license.dat"),
		apiURL: server.URL,
		http:   server.Client(),
		state:  state{SchemaVersion: stateSchemaVersion, AccessToken: "access", RefreshToken: "refresh", DeviceID: "device", Lease: "lease"},
	}
	server.Close()

	if err := c.ReconcileSession(context.Background()); err == nil {
		t.Fatal("closed server unexpectedly reconciled")
	}
	if c.state.AccessToken != "access" || c.state.RefreshToken != "refresh" || c.state.DeviceID != "device" || c.state.Lease != "lease" {
		t.Fatalf("network failure destroyed cached state: %+v", c.state)
	}
}

// Setting the system clock back must not stretch the offline grace: not before
// the lease was issued, and not before a time this client has already seen.
func TestOfflineGraceRejectsClockSetBack(t *testing.T) {
	c, private := testClient(t)
	fp := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
	c.state.DeviceID = "device"
	now := time.Now()
	lease := func(issued time.Time) string {
		return signedLease(t, private, map[string]any{"sub": "user", "did": "device", "fph": hex.EncodeToString(fp[:]), "minVersion": "1.8.0",
			"iat": issued.Unix(), "exp": issued.Add(time.Hour).Unix(), "entitlementExp": now.Add(30 * 24 * time.Hour).Unix(), "grace": 72})
	}

	// Lease issued "in the future" = the clock now reads earlier than the server did.
	c.state.Lease = lease(now.Add(2 * time.Hour))
	if s := c.Status(); s.Authenticated || s.Error != errClockRolledBack.Error() {
		t.Fatalf("clock behind the lease issue time accepted: %+v", s)
	}
	if err := c.EnsureEntitled(); err == nil {
		t.Fatal("EnsureEntitled accepted a clock set back before the lease")
	}

	// Normal offline use advances the high-water mark...
	c.state.Lease, c.state.LastSeenAt = lease(now.Add(-time.Hour)), 0
	if s := c.Status(); !s.Authenticated {
		t.Fatalf("valid offline lease rejected: %+v", s)
	}
	// ...a later reading raises it; going back below it is refused.
	c.state.LastSeenAt = now.Add(48 * time.Hour).Unix()
	if s := c.Status(); s.Authenticated || s.Error != errClockRolledBack.Error() {
		t.Fatalf("clock set back below the latest seen time accepted: %+v", s)
	}
	// Small corrections (NTP) are tolerated.
	c.state.LastSeenAt = now.Add(5 * time.Minute).Unix()
	if s := c.Status(); !s.Authenticated {
		t.Fatalf("a 5-minute clock correction was treated as tampering: %+v", s)
	}
}
