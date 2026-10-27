package dnswarm

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClearForgetsDomainsAndFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dnswarm.json")
	now := time.Now()
	s := Load(p, now)
	s.Observe([]string{"www.google.com", "github.com"}, now)
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if len(s.Top(10)) != 0 {
		t.Fatalf("still has %v", s.Top(10))
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("file not removed: %v", err)
	}
	if err := s.Clear(); err != nil { // idempotent
		t.Fatal(err)
	}
}
