package license

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type fakeMachine struct {
	slowCalls int
	slowFails int // the first N slow-probe attempts fail
}

func (f *fakeMachine) probe() machineProbe {
	return machineProbe{
		stable: func() []string { return []string{"machine-guid=abc", "biosvendor=acme"} },
		slow: func(time.Duration) ([]string, error) {
			f.slowCalls++
			if f.slowCalls <= f.slowFails {
				return nil, errors.New("probe timed out")
			}
			return []string{"baseboard-serial=sn1", "system-uuid=u1"}, nil
		},
	}
}

const (
	fullMachine   = "baseboard-serial=sn1\nbiosvendor=acme\nmachine-guid=abc\nsystem-uuid=u1"
	stableMachine = "biosvendor=acme\nmachine-guid=abc"
)

func TestMachineIDIsStoredAndNeverProbedAgain(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	first := &fakeMachine{}
	if got := resolveMachineID(path, first.probe()); got != fullMachine {
		t.Fatalf("first start: %q", got)
	}
	// Later starts on which the probe would time out must return the same
	// identity — and must not even run the probe.
	broken := &fakeMachine{slowFails: 99}
	for i := 0; i < 3; i++ {
		if got := resolveMachineID(path, broken.probe()); got != fullMachine {
			t.Fatalf("start %d with a failing probe changed the identity: %q", i, got)
		}
	}
	if broken.slowCalls != 0 {
		t.Fatalf("stored identity still ran the slow probe %d times", broken.slowCalls)
	}
}

func TestMachineIDRetriesTheSlowProbeWithinOneStart(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	flaky := &fakeMachine{slowFails: len(machineProbeTimeouts) - 1}
	if got := resolveMachineID(path, flaky.probe()); got != fullMachine {
		t.Fatalf("a probe that succeeds on the last attempt was not used: %q", got)
	}
}

// An existing install registered with the full component set: one start with a
// failed probe must not freeze the reduced set as its identity.
func TestMachineIDFailedProbeIsNotStoredAsIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	broken := &fakeMachine{slowFails: 99}
	if got := resolveMachineID(path, broken.probe()); got != stableMachine {
		t.Fatalf("failed probe: %q", got)
	}
	healthy := &fakeMachine{}
	if got := resolveMachineID(path, healthy.probe()); got != fullMachine {
		t.Fatalf("next start with a working probe: %q", got)
	}
	if got := resolveMachineID(path, broken.probe()); got != fullMachine {
		t.Fatalf("identity changed after it was stored: %q", got)
	}
}

// Where the probe never works, the stable components have always been the
// fingerprint: store them after a few starts instead of probing forever.
func TestMachineIDStoresStableSetAfterRepeatedFailures(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	for i := 0; i < maxFailedMachineProbes; i++ {
		broken := &fakeMachine{slowFails: 99}
		if got := resolveMachineID(path, broken.probe()); got != stableMachine {
			t.Fatalf("start %d: %q", i, got)
		}
	}
	healthy := &fakeMachine{}
	if got := resolveMachineID(path, healthy.probe()); got != stableMachine {
		t.Fatalf("identity changed after it was stored: %q", got)
	}
	if healthy.slowCalls != 0 {
		t.Fatal("stored identity still ran the slow probe")
	}
}

func TestMachineIDRecomputesWhenStoreIsUnreadable(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	if err := os.WriteFile(path, []byte("not a sealed record"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := resolveMachineID(path, (&fakeMachine{}).probe()); got != fullMachine {
		t.Fatalf("unreadable store: %q", got)
	}
	if got := resolveMachineID(path, (&fakeMachine{slowFails: 99}).probe()); got != fullMachine {
		t.Fatalf("store was not rewritten: %q", got)
	}
}

func TestMachineIDWithoutSlowProbeIsStoredAtOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), machineStoreFile)
	host := "office-mac.local"
	probe := machineProbe{stable: func() []string { return []string{host} }}
	if got := resolveMachineID(path, probe); got != "office-mac.local" {
		t.Fatalf("first start: %q", got)
	}
	host = "office-mac.lan" // the host name follows the network on macOS
	if got := resolveMachineID(path, probe); got != "office-mac.local" {
		t.Fatalf("a renamed host changed the identity: %q", got)
	}
}

func TestMachineStoreIsSealedOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("DPAPI is Windows-only; other platforms store pass-through")
	}
	path := filepath.Join(t.TempDir(), machineStoreFile)
	resolveMachineID(path, (&fakeMachine{}).probe())
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("machine-guid")) || bytes.Contains(raw, []byte("sn1")) {
		t.Fatal("device store is readable without DPAPI")
	}
}
