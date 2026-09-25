package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestShouldResume(t *testing.T) {
	now := time.Now()
	marker := func(running bool, at time.Time) []byte {
		b, _ := json.Marshal(resumeState{ProxyRunning: running, From: "1.9.53", At: at})
		return b
	}
	for _, c := range []struct {
		name string
		data []byte
		want bool
	}{
		{"running, fresh", marker(true, now.Add(-30*time.Second)), true},
		{"not running", marker(false, now), false},
		{"stale marker", marker(true, now.Add(-2*time.Hour)), false},
		{"from the future", marker(true, now.Add(time.Hour)), false},
		{"corrupt", []byte("{"), false},
	} {
		st, fresh := parseResume(c.data, now)
		if got := fresh && st.ProxyRunning; got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestInstallFailedAndBackoff(t *testing.T) {
	// The old version quit to install 1.9.55 and came back up: failed.
	if !installFailed(resumeState{From: "1.9.54", To: "1.9.55"}, "1.9.54") {
		t.Error("same version restarted after an install must count as failed")
	}
	// The new version started: success.
	if installFailed(resumeState{From: "1.9.54", To: "1.9.55"}, "1.9.55") {
		t.Error("new version running is a success")
	}
	// Markers from older clients carry no target version.
	if installFailed(resumeState{From: "1.9.53"}, "1.9.53") {
		t.Error("marker without a target version must not count as failed")
	}

	now := time.Now()
	rec := func(v string, at time.Time) []byte { b, _ := json.Marshal(failedUpdate{Version: v, At: at}); return b }
	for _, c := range []struct {
		name    string
		data    []byte
		version string
		want    bool
	}{
		{"same version, just failed", rec("1.9.55", now.Add(-time.Hour)), "1.9.55", true},
		{"newer release is tried", rec("1.9.55", now.Add(-time.Hour)), "1.9.56", false},
		{"backoff over", rec("1.9.55", now.Add(-25*time.Hour)), "1.9.55", false},
		{"clock went back", rec("1.9.55", now.Add(time.Hour)), "1.9.55", false},
		{"corrupt", []byte("x"), "1.9.55", false},
	} {
		if got := recentlyFailed(c.data, c.version, now); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
