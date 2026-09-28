package powervpn

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"strings"
	"unicode/utf8"

	"proxysplit/internal/license"
)

// Device identifies this installation to the panel (design §0 / §2.1).
type Device struct {
	ID   string // sha256("PowerVPN-Device-v1\0" + machine id), lowercase hex
	Name string // ≤ 64 chars
	OS   string // e.g. "windows 10.0.26100"
}

// DeviceIDFor derives the panel device ID from a machine identifier.
func DeviceIDFor(machine string) string {
	sum := sha256.Sum256([]byte("PowerVPN-Device-v1\x00" + machine))
	return hex.EncodeToString(sum[:])
}

// CurrentDevice uses the same machine identity as ProxySplit licensing.
func CurrentDevice() Device {
	host, _ := os.Hostname()
	machine := license.MachineID()
	if machine == "" {
		machine = host
	}
	return Device{ID: DeviceIDFor(machine), Name: truncateRunes(strings.TrimSpace(host), 64), OS: osVersion()}
}

// Apply sets the device headers on a request.
func (d Device) Apply(h http.Header) {
	h.Set("X-Device-Id", d.ID)
	// The panel decodeURIComponent()s name/OS (host names may be Chinese).
	h.Set("X-Device-Name", encodeURIComponent(firstNonEmpty(headerSafe(d.Name), "Windows PC")))
	if d.OS != "" {
		h.Set("X-Device-OS", encodeURIComponent(d.OS))
	}
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

// encodeURIComponent matches JavaScript's encodeURIComponent.
func encodeURIComponent(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

// headerSafe drops control characters.
func headerSafe(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, s)
}
