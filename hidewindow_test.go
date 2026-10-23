package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every child process must hide its console: a missing flag flashes a black
// window on the customer's screen (owner, 2026-10-23: one popped on every
// start). The hide call has to sit within a few lines of exec.Command.
func TestChildProcessesHideConsole(t *testing.T) {
	spawn := regexp.MustCompile(`exec\.Command(Context)?\(`)
	hide := regexp.MustCompile(`hideWindow\(|hideVersionWindow\(|SysProcAttr`)
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "node_modules", "frontend", "website", "server", "build", "output", ".git":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || strings.HasSuffix(path, "_other.go") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		lines := strings.Split(string(raw), "\n")
		for i, l := range lines {
			if !spawn.MatchString(l) {
				continue
			}
			end := min(i+8, len(lines))
			if !hide.MatchString(strings.Join(lines[i:end], "\n")) {
				t.Errorf("%s:%d starts a process without hiding its console window", path, i+1)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
