package service

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// windivertServices lists installed WinDivert driver services (ours is
// "WinDivert"; other tools ship their own versions under other names, and a
// different version already loaded makes our open fail).
func windivertServices() []string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services`, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	var out []string
	for _, n := range names {
		if strings.Contains(strings.ToLower(n), "windivert") {
			out = append(out, n)
		}
	}
	return out
}

// regDword reads a DWORD, -1 when missing.
func regDword(path, name string) int {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return -1
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue(name)
	if err != nil {
		return -1
	}
	return int(v)
}

// captureDiag is the one-line driver diagnosis written to the (uploaded) log
// when WinDivert fails to open.
func (s *Service) captureDiag() string {
	sec := DetectSecuritySoftware()
	return fmt.Sprintf("security=%s windivertServices=%s hvci=%d vulnDriverBlocklist=%d",
		strings.Join(sec, "|"), strings.Join(windivertServices(), "|"),
		regDword(`SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity`, "Enabled"),
		regDword(`SYSTEM\CurrentControlSet\Control\CI\Config`, "VulnerableDriverBlocklistEnable"))
}
