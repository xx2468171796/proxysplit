//go:build windows

package license

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

// platformMachineProbe: registry values are the stable components; the SMBIOS
// serials read through PowerShell / CIM are the slow ones (they can time out
// while Windows is still starting, which is why the result is stored — see
// machine_store.go).
func platformMachineProbe() machineProbe {
	return machineProbe{stable: registryParts, slow: smbiosSerialParts}
}

func registryParts() []string {
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
	return parts
}

// smbiosSerialParts reads the SMBIOS serials, which make the identity survive
// Windows reinstalls. An error means the probe did not complete (timeout,
// PowerShell / WMI unavailable) — not that the machine has no serials.
func smbiosSerialParts(timeout time.Duration) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	script := `$b=Get-CimInstance Win32_BaseBoard|Select-Object -First 1 SerialNumber;$s=Get-CimInstance Win32_ComputerSystemProduct|Select-Object -First 1 UUID;$x=@{baseboard=$b.SerialNumber;uuid=$s.UUID};$x|ConvertTo-Json -Compress`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // no console flash on every start
	raw, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("SMBIOS probe: %w", err)
	}
	var out struct {
		Baseboard string `json:"baseboard"`
		UUID      string `json:"uuid"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("SMBIOS probe output: %w", err)
	}
	var parts []string
	if v := normalizeHardware(out.Baseboard); usableSerial(v) {
		parts = append(parts, "baseboard-serial="+v)
	}
	if v := normalizeHardware(out.UUID); usableSerial(v) {
		parts = append(parts, "system-uuid="+v)
	}
	return parts, nil
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
