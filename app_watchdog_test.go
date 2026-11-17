package main

import (
	"testing"

	"proxysplit/internal/license"
)

func TestWatchdogMustCheck(t *testing.T) {
	cases := []struct {
		name         string
		st           license.Status
		proxyRunning bool
		want         bool
	}{
		{"signed in", license.Status{SignedIn: true, Authenticated: true}, false, true},
		{"signed in, waiting for a device slot", license.Status{SignedIn: true}, false, true},
		// The bug: the session was cleared, so enforcement stopped while the
		// lease still authenticated and the proxy kept running.
		{"session gone, lease still valid", license.Status{Authenticated: true}, true, true},
		{"session gone, lease still valid, proxy stopped", license.Status{Authenticated: true}, false, true},
		{"signed out but the proxy is still running", license.Status{}, true, true},
		{"signed out, nothing running", license.Status{}, false, false},
	}
	for _, tc := range cases {
		if got := watchdogMustCheck(tc.st, tc.proxyRunning); got != tc.want {
			t.Errorf("%s: watchdogMustCheck = %v, want %v", tc.name, got, tc.want)
		}
	}
}
