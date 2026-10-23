//go:build windows

package license

import (
	"context"
	"encoding/json"
	"os/exec"
	"sort"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

func machineID() string {
	parts := make([]string, 0, 12)
	k, e := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if e == nil {
		if v, _, err := k.GetStringValue("MachineGuid"); err == nil {
			parts = append(parts, "machine-guid="+normalizeHardware(v))
		}
		k.Close()
	}
	if bios, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DESCRIPTION\System\BIOS`, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		for _, name := range []string{"BaseBoardManufacturer", "BaseBoardProduct", "BaseBoardVersion", "BIOSVendor", "BIOSVersion", "SystemManufacturer", "SystemProductName", "SystemVersion"} {
			if v, _, err := bios.GetStringValue(name); err == nil && normalizeHardware(v) != "" {
				parts = append(parts, strings.ToLower(name)+"="+normalizeHardware(v))
			}
		}
		bios.Close()
	}
	// SMBIOS serials make the identity survive Windows reinstalls. CIM is used
	// only as an additional signal; registry data remains the fallback on
	// stripped-down systems where PowerShell/WMI is unavailable.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	script := `$b=Get-CimInstance Win32_BaseBoard|Select-Object -First 1 SerialNumber;$s=Get-CimInstance Win32_ComputerSystemProduct|Select-Object -First 1 UUID;$x=@{baseboard=$b.SerialNumber;uuid=$s.UUID};$x|ConvertTo-Json -Compress`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // no console flash on every start
	if raw, err := cmd.Output(); err == nil {
		var out struct {
			Baseboard string `json:"baseboard"`
			UUID      string `json:"uuid"`
		}
		if json.Unmarshal(raw, &out) == nil {
			if v := normalizeHardware(out.Baseboard); usableSerial(v) {
				parts = append(parts, "baseboard-serial="+v)
			}
			if v := normalizeHardware(out.UUID); usableSerial(v) {
				parts = append(parts, "system-uuid="+v)
			}
		}
	}
	sort.Strings(parts)
	return strings.Join(parts, "\n")
}

func normalizeHardware(v string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(v)), " "))
}

func usableSerial(v string) bool {
	if v == "" || v == "none" || v == "unknown" || v == "default string" || v == "to be filled by o.e.m." {
		return false
	}
	return true
}
