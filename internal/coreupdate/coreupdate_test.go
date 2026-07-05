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
