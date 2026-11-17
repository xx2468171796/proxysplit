package license

import (
	"path/filepath"
	"sync"
)

var (
	machineOnce  sync.Once
	machineVal   string
	machineStore string // sealed component store; "" = not stored
)

// UseMachineStore sets the data dir in which the machine identity is stored
// (machine_store.go). It must run before the first MachineID call; New does it.
func UseMachineStore(dataDir string) {
	if dataDir != "" {
		machineStore = filepath.Join(dataDir, machineStoreFile)
	}
}

// MachineID returns the stable machine identifier used for the ProxySplit
// device fingerprint: computed once, stored in the data dir, reused on every
// later start (cached for the process). Shared with internal/powervpn so the
// POWER云 device ID is the same identity and just as stable.
func MachineID() string {
	machineOnce.Do(func() { machineVal = resolveMachineID(machineStore, platformMachineProbe()) })
	return machineVal
}

// Protect / Unprotect seal small secrets to the current Windows user (DPAPI),
// exactly like license.dat. Other platforms are pass-through (dev builds only).
func Protect(input []byte) ([]byte, error)   { return protect(input) }
func Unprotect(input []byte) ([]byte, error) { return unprotect(input) }
