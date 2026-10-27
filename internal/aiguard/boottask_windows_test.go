package aiguard

import (
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
	"unicode/utf16"
)

// The boot task may only point our rule at the dead loopback server: never
// remove it, never point it anywhere else.
func TestBootScriptOnlyRelocks(t *testing.T) {
	s := bootScript()
	if !strings.Contains(s, "'"+ruleComment+"'") || !strings.Contains(s, "-NameServers '"+LockedServer+"'") {
		t.Fatalf("script must re-point our rule at %s: %s", LockedServer, s)
	}
	if strings.Contains(s, "Remove-DnsClientNrptRule") || strings.Contains(s, TunnelServer) {
		t.Fatalf("boot script must never unlock: %s", s)
	}
}

func TestEncodedCommandRoundTrip(t *testing.T) {
	raw, err := base64.StdEncoding.DecodeString(encodedCommand(bootScript()))
	if err != nil || len(raw)%2 != 0 {
		t.Fatalf("bad encoding: %v", err)
	}
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(raw[2*i:])
	}
	if got := string(utf16.Decode(units)); got != bootScript() {
		t.Fatalf("round trip mismatch: %q", got)
	}
	if x := bootTaskXML(); !strings.Contains(x, "<BootTrigger>") || !strings.Contains(x, "S-1-5-18") {
		t.Fatal("task must run as SYSTEM at boot")
	}
}
