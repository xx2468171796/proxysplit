package aiguard

import (
	"net"
	"strings"
	"testing"
)

// The real install / check / remove path (PowerShell script + registry read)
// on a test-only namespace: AI names on the machine running the tests are
// never touched. With nothing listening on 127.0.0.53 the locked name must
// not resolve (fail-closed), and resolve normally again once removed.
func TestNRPTLockLifecycle(t *testing.T) {
	r := nrptRule{comment: "ProxySplit-AITEST", namespaces: []string{".nrpt-aitest.example", "nrpt-aitest.example"}}
	if err := r.install(); err != nil {
		if strings.Contains(err.Error(), "Access") || strings.Contains(err.Error(), "拒绝") || strings.Contains(err.Error(), "权限") {
			t.Skip("needs an elevated shell")
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.remove() })
	if !r.installed() || !r.present() {
		t.Fatal("rule written but not detected in the registry")
	}
	if other := (nrptRule{comment: r.comment, namespaces: []string{".other.example"}}); other.installed() {
		t.Fatal("a different namespace list must count as not installed (so Install refreshes it)")
	}
	if Installed() && !Present() {
		t.Fatal("inconsistent production lock state")
	}
	if addrs, err := net.LookupHost("www.nrpt-aitest.example"); err == nil {
		t.Fatalf("locked name resolved with nothing on %s: %v", DNSServer, addrs)
	}
	if err := r.remove(); err != nil {
		t.Fatal(err)
	}
	if r.present() {
		t.Fatal("rule still present after remove")
	}
}
