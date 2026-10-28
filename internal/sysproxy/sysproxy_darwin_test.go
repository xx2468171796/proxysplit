package sysproxy

import "testing"

func TestParseScutil(t *testing.T) {
	on, s := parseScutil("<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 7890\n  HTTPProxy : 127.0.0.1\n}\n")
	if !on || s != "127.0.0.1:7890" {
		t.Fatal(on, s)
	}
	if on, _ := parseScutil("<dictionary> {\n  HTTPEnable : 0\n}\n"); on {
		t.Fatal("off")
	}
}
