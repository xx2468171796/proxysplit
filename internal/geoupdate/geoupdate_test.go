package geoupdate

import (
	"os"
	"path/filepath"
	"testing"
)

// TestUpdateDirect downloads the rule-sets directly (this machine can reach
// GitHub) and checks all three land with the SRS magic. Skips offline.
func TestUpdateDirect(t *testing.T) {
	dir := t.TempDir()
	n, err := Update(dir, "") // direct
	if err != nil {
		t.Skipf("network/update failed (expected behind GFW without proxy): %v", err)
	}
	if n != 3 {
		t.Fatalf("updated %d rule-sets, want 3", n)
	}
	for _, name := range []string{"geoip-cn.srs", "geosite-cn.srs", "geosite-category-ads-all.srs"} {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(b) < 3 || string(b[:3]) != "SRS" {
			t.Fatalf("%s: not a valid rule-set (%d bytes)", name, len(b))
		}
		t.Logf("%s -> %d bytes OK", name, len(b))
	}
}
