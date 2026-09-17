package coreupdate

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

func TestReleaseChecksum(t *testing.T) {
	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(hash + "  core.zip\n"))
	}))
	defer server.Close()
	for _, tc := range []struct {
		name, digest, manifest string
		wantErr                bool
	}{
		{"github digest without manifest", "sha256:" + hash, "", false},
		{"legacy manifest", "", server.URL, false},
		{"no integrity metadata", "", "", true},
		{"invalid digest", "sha256:bad", server.URL, true},
		{"wrong algorithm", "md5:" + hash, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := releaseChecksum(server.Client(), tc.digest, tc.manifest, "core.zip")
			if (err != nil) != tc.wantErr || (!tc.wantErr && got != hash) {
				t.Fatalf("checksum=%q err=%v", got, err)
			}
		})
	}
}

// TestLatestVersion checks we can reach the GitHub release API and parse a
// version (direct; this machine can reach GitHub). Skips on network failure.
func TestLatestVersion(t *testing.T) {
	v, err := LatestVersion("")
	if err != nil {
		t.Skipf("network/API failed (expected behind GFW without proxy): %v", err)
	}
	if !regexp.MustCompile(`^\d+\.\d+`).MatchString(v) {
		t.Fatalf("unexpected version %q", v)
	}
	t.Logf("latest sing-box version: %s", v)
}

func TestChecksumForAsset(t *testing.T) {
	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	got, err := checksumForAsset([]byte(hash+"  sing-box-test-windows-amd64.zip\n"), "sing-box-test-windows-amd64.zip")
	if err != nil || got != hash {
		t.Fatalf("checksum lookup failed: got=%q err=%v", got, err)
	}
	if _, err := checksumForAsset([]byte(hash+"  other.zip\n"), "wanted.zip"); err == nil {
		t.Fatal("missing asset checksum accepted")
	}
}
