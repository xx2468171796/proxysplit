package main

import "testing"

// 劫持模式 can only be lifted by the in-app 恢复: sign-out, a lost session or
// a wiped data directory never turn it off.
func TestHijackDecision(t *testing.T) {
	for _, c := range []struct {
		name               string
		state              string
		lock, aiSignedIn   bool
		wantOn, wantRecord bool
	}{
		{"recorded on, signed out, lock deleted by someone", hijackOn, false, false, true, false},
		{"restored in the app, AI customer signs in again", hijackOff, true, true, false, false},
		{"fresh AI-site customer signs in", "", false, true, true, true},
		{"data directory wiped while locked", "", true, false, true, true},
		{"ordinary user", "", false, false, false, false},
	} {
		on, record := hijackDecision(c.state, c.lock, c.aiSignedIn)
		if on != c.wantOn || record != c.wantRecord {
			t.Errorf("%s: on=%v record=%v, want %v/%v", c.name, on, record, c.wantOn, c.wantRecord)
		}
	}
}
