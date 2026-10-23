package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"proxysplit/internal/core"
)

// The port and credentials stay put across core restarts; the contract file
// follows start / stop.
func TestAIProxyContract(t *testing.T) {
	s := &Service{}
	file := filepath.Join(t.TempDir(), "ai-proxy.json")
	s.SetAIProxyFile(file)
	a := s.aiProxyLocked("proxy")
	b := s.aiProxyLocked("reject")
	if a.Port == 0 || a.Port != b.Port || a.Pass == "" || a.Pass != b.Pass {
		t.Fatalf("port / credentials moved: %+v %+v", a, b)
	}
	s.noteAIProxyLocked(a)
	var got AIProxyInfo
	raw, _ := os.ReadFile(file)
	json.Unmarshal(raw, &got)
	if !got.Running || !got.Available || got.Port != a.Port || got.URL == "" || got.Version != 1 {
		t.Fatalf("started contract: %+v", got)
	}
	s.noteAIProxyLocked(&core.AIProxy{Port: a.Port, User: a.User, Pass: a.Pass, Outbound: "reject"})
	raw, _ = os.ReadFile(file)
	json.Unmarshal(raw, &got)
	if got.Available {
		t.Fatal("no line must read available=false")
	}
	s.noteAIProxyLocked(nil)
	raw, _ = os.ReadFile(file)
	got = AIProxyInfo{}
	json.Unmarshal(raw, &got)
	if got.Running || got.URL != "" {
		t.Fatalf("stopped contract still usable: %+v", got)
	}
}
