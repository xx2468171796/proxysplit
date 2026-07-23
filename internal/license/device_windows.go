//go:build windows

package license

import "golang.org/x/sys/windows/registry"

func machineID() string {
	k, e := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if e != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue("MachineGuid")
	return v
}
