package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func testKeys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	return public, private, base64.StdEncoding.EncodeToString(der)
}

func signedRelease(private ed25519.PrivateKey, version, hash, url string) Release {
	sig := ed25519.Sign(private, []byte(SigningMessage(version, hash, url)))
	return Release{
		Version: version, MinimumVersion: "1.8.0", URL: url, SHA256: hash,
		Signature: base64.StdEncoding.EncodeToString(sig),
	}
}

func TestCheckAndDownloadSignedRelease(t *testing.T) {
	_, private, encoded := testKeys(t)
	payload := []byte("fake portable exe")
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	var release Release
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/releases/latest" {
			_ = json.NewEncoder(w).Encode(map[string]any{"release": release})
			return
		}
		if r.URL.Path == "/proxysplit.exe" {
			_, _ = w.Write(payload)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	release = signedRelease(private, "1.8.3", hash, server.URL+"/proxysplit.exe")
	client := New(server.URL, "1.8.2", t.TempDir(), encoded, "")
	client.http = server.Client()
	status := client.Check(context.Background())
	if status.Error != "" || !status.Available || status.Release == nil || status.Release.Version != "1.8.3" {
		t.Fatalf("signed update not found: %+v", status)
	}
	path, err := client.Download(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != string(payload) {
		t.Fatalf("download mismatch: %q", got)
	}
}

func TestTamperedReleaseRejected(t *testing.T) {
	_, private, encoded := testKeys(t)
	release := signedRelease(private, "1.8.3", strings.Repeat("a", 64), "https://updates.invalid/proxysplit.exe")
	client := New("https://updates.invalid", "1.8.2", t.TempDir(), encoded, "")
	release.SHA256 = "b" + release.SHA256[1:]
	if err := client.verifyRelease(release); err == nil {
		t.Fatal("tampered release was accepted")
	}
}
