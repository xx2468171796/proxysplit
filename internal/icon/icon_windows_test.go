//go:build windows

package icon

import (
	"strings"
	"testing"
)

func TestPNGBase64ExtractsWindowsShellIcon(t *testing.T) {
	uri, err := PNGBase64(`C:\Windows\System32\notepad.exe`)
	if err != nil || !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("expected notepad shell icon data URI, got %q, err=%v", uri, err)
	}
}
