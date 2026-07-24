package license

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
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
