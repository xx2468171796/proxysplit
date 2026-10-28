package appid

import "testing"

func TestCheckDirMac(t *testing.T) {
	for in, want := range map[string]string{
		"/Applications/Google Chrome.app":    "/Applications/Google Chrome.app/",
		"/Applications/Google Chrome.app/":   "/Applications/Google Chrome.app/",
		"/System/Applications/Mail.app":      "/System/Applications/Mail.app/",
		"/Users/bob/Applications/Cursor.app": "/Users/bob/Applications/Cursor.app/",
	} {
		if got, err := CheckDir(in); err != nil || got != want {
			t.Errorf("CheckDir(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"/Applications", "/Applications/Utilities", "/System/Library", "/System", "/Users", "/usr/local", "/"} {
		if got, err := CheckDir(bad); err == nil {
			t.Errorf("CheckDir(%q) = %q, want an error", bad, got)
		}
	}
}
