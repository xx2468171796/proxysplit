package service

import (
	"testing"

	"proxysplit/internal/core"
)

func TestStreamPresetIsOverridable(t *testing.T) {
	got := streamPresetApps(map[string]string{"obs64.exe": "rule|proxy|global"})
	for _, n := range got {
		if n == "obs64.exe" {
			t.Fatal("a preset app the user listed must follow the user's list")
		}
	}
	if len(got) != len(streamPreset)-1 {
		t.Fatalf("unlisted preset apps must go direct: %v", got)
	}
}

func TestPrepareProcessCaptureReusesPorts(t *testing.T) {
	s := &Service{onLog: func(string) {}, wdReady: func() bool { return true }}
	opts := core.Options{Split: true, SplitWhitelist: true, SplitGroups: []core.SplitGroup{{Key: "a", NodeTag: "proxy"}}}
	if err := s.prepareProcessCapture(Settings{CaptureMode: CaptureTUN}, &opts, nil); err != nil || opts.Process != nil {
		t.Fatal("explicit 整机虚拟网卡 must stay TUN")
	}
	if err := s.prepareProcessCapture(Settings{}, &opts, nil); err != nil || opts.Process == nil {
		t.Fatalf("process mode not prepared: %v", err)
	}
	first := opts.Process.Ports
	again := opts
	again.Process = nil
	if err := s.prepareProcessCapture(Settings{CaptureMode: CaptureProcess}, &again, first); err != nil {
		t.Fatal(err)
	}
	for tag, p := range first {
		if again.Process.Ports[tag] != p {
			t.Fatalf("hot apply must keep inbound %s on port %d (got %d)", tag, p, again.Process.Ports[tag])
		}
	}
}

// Without the driver the default must still start (TUN this once), never fail.
func TestProcessCaptureFallsBackWithoutDriver(t *testing.T) {
	s := &Service{onLog: func(string) {}, wdReady: func() bool { return false }, wdFetch: make(chan struct{})}
	opts := core.Options{Split: true, SplitWhitelist: true, SplitGroups: []core.SplitGroup{{Key: "a", NodeTag: "proxy"}}}
	if err := s.prepareProcessCapture(Settings{}, &opts, nil); err != nil || opts.Process != nil {
		t.Fatalf("missing driver must fall back to TUN: %v", err)
	}
}
