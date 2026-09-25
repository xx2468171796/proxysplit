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
		if _, got := shouldResume(c.data, now); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
