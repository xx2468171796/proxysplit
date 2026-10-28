package proc

import "testing"

func TestParsePSGroupsBundles(t *testing.T) {
	out := `/sbin/launchd
/usr/libexec/logd
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/A/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper
/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/A/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper
/opt/homebrew/bin/node
(kernel_task)
`
	got := parsePS(out)
	if len(got) != 2 {
		t.Fatalf("%+v", got)
	}
	if got[0].Desc != "Google Chrome" || got[0].Path != "/Applications/Google Chrome.app" || got[0].Count != 3 || got[0].Name != "Google Chrome" {
		t.Fatalf("chrome: %+v", got[0])
	}
	if got[1].Name != "node" || got[1].Path != "/opt/homebrew/bin/node" {
		t.Fatalf("node: %+v", got[1])
	}
}
