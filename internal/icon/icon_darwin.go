// Package icon renders an app's icon for the app picker. On macOS the icon is
// the bundle's .icns (Info.plist CFBundleIconFile), converted to a 64 px PNG
// with the system's sips; results are cached per bundle.
package icon

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"proxysplit/internal/proc"
)

var (
	mu    sync.Mutex
	cache = map[string]string{}
)

// PNGBase64 returns the icon of the app containing path as a PNG data URI.
// Best effort: ("", nil) when there is no bundle or icon.
func PNGBase64(path string) (string, error) {
	app := proc.BundleOf(path)
	if app == "" {
		return "", nil
	}
	mu.Lock()
	uri, ok := cache[app]
	mu.Unlock()
	if ok {
		return uri, nil
	}
	uri = render(app)
	mu.Lock()
	cache[app] = uri
	mu.Unlock()
	return uri, nil
}

func render(app string) string {
	res := filepath.Join(app, "Contents", "Resources")
	name := plistValue(filepath.Join(app, "Contents", "Info.plist"), "CFBundleIconFile")
	if name == "" {
		name = "AppIcon"
	}
	if filepath.Ext(name) == "" {
		name += ".icns"
	}
	src := filepath.Join(res, name)
	if _, err := os.Stat(src); err != nil {
		return ""
	}
	dir, err := os.MkdirTemp("", "ps-icon-")
	if err != nil {
		return ""
	}
	defer os.RemoveAll(dir)
	dst := filepath.Join(dir, "icon.png")
	if err := exec.Command("/usr/bin/sips", "-s", "format", "png", "-Z", "64", src, "--out", dst).Run(); err != nil {
		return ""
	}
	b, err := os.ReadFile(dst)
	if err != nil || len(b) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b)
}

func plistValue(plist, key string) string {
	out, err := exec.Command("/usr/libexec/PlistBuddy", "-c", "Print :"+key, plist).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
