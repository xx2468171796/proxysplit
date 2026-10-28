//go:build darwin

package core

import (
	"regexp"
	"strings"
	"testing"
)

func TestDirRegexMacBundle(t *testing.T) {
	re := regexp.MustCompile(DirRegex("/Applications/Google Chrome.app"))
	helper := "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper"
	if !re.MatchString(helper) || !re.MatchString("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") {
		t.Fatal("bundle processes must match")
	}
	if re.MatchString("/Applications/Google Chrome.app2/x") || re.MatchString("/Applications/google chrome.app/Contents/MacOS/x") {
		t.Fatal("other folders must not match")
	}
	if DirRegex("/Applications/X.app/") != DirRegex("/Applications/X.app") {
		t.Fatal("trailing slash")
	}
}

func TestTUNKeepsTailscaleOut(t *testing.T) {
	ins := tunInbounds(Options{}, "172.19.0.1/30")
	ex, _ := ins[0]["route_exclude_address"].([]string)
	if !strings.Contains(strings.Join(ex, ","), "100.64.0.0/10") {
		t.Fatalf("tailscale not excluded: %v", ins[0])
	}
}
