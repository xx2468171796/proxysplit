package license

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The device fingerprint must never change on a machine that did not change:
// a different fingerprint is DEVICE_MISMATCH on the server — the user is
// signed out and a new device slot is consumed. Some identity components come
// from a probe that can fail or time out (SMBIOS serials through PowerShell on
// Windows), and the host name used on macOS changes with the network. So the
// component set is computed once, stored sealed (DPAPI on Windows) in the data
// dir, and reused from then on; a later probe is never consulted again.

const machineStoreFile = "device.dat"

// machineProbeTimeouts are the attempts made, within one start, to read the
// slow components before the result is stored.
var machineProbeTimeouts = []time.Duration{4 * time.Second, 8 * time.Second, 15 * time.Second}

// maxFailedMachineProbes is how many starts may fail the slow probe before the
// stable components alone are stored as this machine's identity: on a system
// where the probe never works (stripped-down Windows without PowerShell / WMI)
// that has always been its fingerprint.
const maxFailedMachineProbes = 3

// machineProbe is how one platform reads its identity components.
type machineProbe struct {
	// stable components are read reliably and quickly (registry, host name).
	stable func() []string
	// slow components may fail or time out; nil when the platform has none.
	slow func(timeout time.Duration) ([]string, error)
}

type machineRecord struct {
	Version int `json:"v"`
	// Parts is the stored component set; empty until it is final.
	Parts []string `json:"parts,omitempty"`
	// FailedProbes counts starts on which every slow-probe attempt failed.
	FailedProbes int `json:"failedProbes,omitempty"`
}

func loadMachineRecord(path string) machineRecord {
	var rec machineRecord
	if path == "" {
		return rec
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return rec
	}
	plain, err := unprotect(raw)
	if err != nil || json.Unmarshal(plain, &rec) != nil || rec.Version != 1 {
		return machineRecord{} // unreadable (other user / machine, damaged): compute again
	}
	return rec
}

func saveMachineRecord(path string, rec machineRecord) {
	if path == "" {
		return
	}
	rec.Version = 1
	raw, err := json.Marshal(rec)
	if err != nil {
		return
	}
	sealed, err := protect(raw)
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0o700) != nil {
		return
	}
	tmp := path + ".tmp"
	if os.WriteFile(tmp, sealed, 0o600) != nil {
		return
	}
	if os.Rename(tmp, path) != nil {
		_ = os.Remove(tmp)
	}
}

// resolveMachineID returns the machine identity: the stored component set when
// there is one, otherwise a freshly probed set, which is stored once complete.
// path "" disables storage.
func resolveMachineID(path string, probe machineProbe) string {
	rec := loadMachineRecord(path)
	if len(rec.Parts) > 0 {
		return strings.Join(rec.Parts, "\n")
	}
	parts := probe.stable()
	complete := probe.slow == nil
	if !complete {
		for _, timeout := range machineProbeTimeouts {
			extra, err := probe.slow(timeout)
			if err == nil {
				parts, complete = append(parts, extra...), true
				break
			}
		}
	}
	sort.Strings(parts)
	if !complete {
		rec.FailedProbes++
		complete = rec.FailedProbes >= maxFailedMachineProbes
	}
	if complete && len(parts) > 0 {
		rec.Parts = parts
	}
	saveMachineRecord(path, rec)
	return strings.Join(parts, "\n")
}
