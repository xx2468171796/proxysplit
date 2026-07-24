package coreupdate

import (
	"regexp"
	"testing"
)

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
