package updater

import (
	"bytes"
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
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
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
		if r.URL.Path == "/proxysplit"+PackageExt {
			_, _ = w.Write(payload)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	release = signedRelease(private, "1.8.3", hash, server.URL+"/proxysplit"+PackageExt)
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
	release := signedRelease(private, "1.8.3", strings.Repeat("a", 64), "https://updates.invalid/proxysplit"+PackageExt)
	client := New("https://updates.invalid", "1.8.2", t.TempDir(), encoded, "")
	release.SHA256 = "b" + release.SHA256[1:]
	if err := client.verifyRelease(release); err == nil {
		t.Fatal("tampered release was accepted")
	}
}

// packageServer serves a signed package; fail decides, per package request,
// whether to break the transfer after sending `cut` bytes.
func packageServer(t *testing.T, payload []byte, cut int, fail func(n int) bool) (*httptest.Server, *[]string) {
	t.Helper()
	var ranges []string
	n := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		ranges = append(ranges, r.Header.Get("Range"))
		if fail(n) {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			_, _ = w.Write(payload[:cut])
			w.(http.Flusher).Flush()
			if c, _, err := w.(http.Hijacker).Hijack(); err == nil {
				_ = c.Close() // connection lost mid-body
			}
			return
		}
		http.ServeContent(w, r, "p", time.Time{}, bytes.NewReader(payload))
	}))
	t.Cleanup(server.Close)
	return server, &ranges
}

func bigPayload() ([]byte, string) {
	payload := bytes.Repeat([]byte("proxysplit package "), 20_000)
	sum := sha256.Sum256(payload)
	return payload, hex.EncodeToString(sum[:])
}

// A download that breaks keeps what it has, and the next attempt continues
// with Range instead of fetching ~130 MB from zero again.
func TestDownloadResumesAfterBrokenTransfer(t *testing.T) {
	_, private, encoded := testKeys(t)
	payload, hash := bigPayload()
	server, ranges := packageServer(t, payload, 100_000, func(n int) bool { return n == 1 })
	release := signedRelease(private, "1.8.3", hash, server.URL+"/proxysplit"+PackageExt)
	dir := t.TempDir()
	client := New(server.URL, "1.8.2", dir, encoded, "")
	client.http = server.Client()

	if _, err := client.Download(context.Background(), release); err == nil {
		t.Fatal("the broken transfer must fail")
	}
	partial := filepath.Join(dir, "updates", "proxysplit-v1.8.3"+PackageExt+".download")
	if st, err := os.Stat(partial); err != nil || st.Size() != 100_000 {
		t.Fatalf("partial file must be kept: %v %v", st, err)
	}
	path, err := client.Download(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, payload) {
		t.Fatal("resumed package differs")
	}
	if len(*ranges) != 2 || (*ranges)[1] != "bytes=100000-" {
		t.Fatalf("ranges asked: %v", *ranges)
	}
}

// A partial file that does not belong to this package (damaged, or the file
// behind the URL changed) fails the signed hash after resuming: it is thrown
// away and fetched once from the start — never accepted, never retried forever.
func TestDownloadRestartsWhenResumedFileFailsHash(t *testing.T) {
	_, private, encoded := testKeys(t)
	payload, hash := bigPayload()
	server, ranges := packageServer(t, payload, 0, func(int) bool { return false })
	release := signedRelease(private, "1.8.3", hash, server.URL+"/proxysplit"+PackageExt)
	dir := t.TempDir()
	client := New(server.URL, "1.8.2", dir, encoded, "")
	client.http = server.Client()
	updates := filepath.Join(dir, "updates")
	_ = os.MkdirAll(updates, 0o700)
	_ = os.WriteFile(filepath.Join(updates, "proxysplit-v1.8.3"+PackageExt+".download"), bytes.Repeat([]byte{'x'}, 5000), 0o600)
	stale := filepath.Join(updates, "proxysplit-v1.8.1"+PackageExt+".download")
	_ = os.WriteFile(stale, []byte("superseded"), 0o600)

	path, err := client.Download(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, payload) {
		t.Fatal("package differs")
	}
	if strings.Join(*ranges, "|") != "bytes=5000-|" {
		t.Fatalf("want one resumed and one fresh request, got %v", *ranges)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("partial downloads of other releases must be removed")
	}

	// A package that is simply wrong is rejected and leaves nothing behind.
	bad := signedRelease(private, "1.8.4", strings.Repeat("0", 64), server.URL+"/proxysplit"+PackageExt)
	if _, err := client.Download(context.Background(), bad); err == nil || !strings.Contains(err.Error(), "SHA256") {
		t.Fatalf("want a hash error, got %v", err)
	}
	if left, _ := filepath.Glob(filepath.Join(updates, "*1.8.4*")); len(left) != 0 {
		t.Fatalf("rejected package left files: %v", left)
	}
}

// The client has no overall deadline (it capped the whole body of a large
// package); connecting and the response headers are bounded instead.
func TestClientHasPhaseTimeoutsNotATotalOne(t *testing.T) {
	c := New("https://updates.invalid", "1.8.2", t.TempDir(), "", "")
	if c.http.Timeout != 0 {
		t.Fatalf("client Timeout = %v: it would cut off slow downloads", c.http.Timeout)
	}
	tr, ok := c.http.Transport.(*http.Transport)
	if !ok || tr.ResponseHeaderTimeout == 0 || tr.TLSHandshakeTimeout == 0 {
		t.Fatalf("transport must bound TLS and response headers: %+v", c.http.Transport)
	}
}
