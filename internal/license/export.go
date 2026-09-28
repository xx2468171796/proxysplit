package license

import "sync"

var (
	machineOnce sync.Once
	machineVal  string
)

// MachineID returns the stable machine identifier also used for the ProxySplit
// device fingerprint (cached; the Windows implementation shells out to CIM).
// Shared with internal/powervpn so the POWER云 device ID uses the same identity.
func MachineID() string {
	machineOnce.Do(func() { machineVal = machineID() })
	return machineVal
}

// Protect / Unprotect seal small secrets to the current Windows user (DPAPI),
// exactly like license.dat. Other platforms are pass-through (dev builds only).
func Protect(input []byte) ([]byte, error)   { return protect(input) }
func Unprotect(input []byte) ([]byte, error) { return unprotect(input) }
