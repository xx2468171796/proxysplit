package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// captureMemo remembers that WinDivert would not open on this PC, so later app
// launches skip the doomed attempt (each one costs a full core restart). A new
// program build or a week later tries the driver again. The UI shows the
// explanation once (it remembers the text it showed).
type captureMemo struct {
	Build  string    `json:"build"` // exe size+mtime: changes on every update
	Failed time.Time `json:"failed"`
	Count  int       `json:"count"`
	Err    string    `json:"err"`
}

const captureRetryAfter = 7 * 24 * time.Hour

func (s *Service) captureMemoPath() string { return filepath.Join(s.dataDir, "capture-fail.json") }

// currentBuild identifies the running program file; "" when unknown.
func currentBuild() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	fi, err := os.Stat(exe)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d-%d", fi.Size(), fi.ModTime().Unix())
}

func (s *Service) loadCaptureMemo() (captureMemo, bool) {
	var m captureMemo
	if s.dataDir == "" {
		return m, false
	}
	b, err := os.ReadFile(s.captureMemoPath())
	if err != nil || json.Unmarshal(b, &m) != nil {
		return m, false
	}
	return m, true
}

func (s *Service) saveCaptureMemo(m captureMemo) {
	if s.dataDir == "" {
		return
	}
	if b, err := json.Marshal(m); err == nil {
		_ = os.WriteFile(s.captureMemoPath(), b, 0o644)
	}
}

// restoreCaptureMemo runs once at startup: a recent failure on this same build
// keeps 仅接管选中程序 on the TUN without trying the driver again.
func (s *Service) restoreCaptureMemo() {
	m, ok := s.loadCaptureMemo()
	if !ok || m.Build == "" || m.Build != currentBuild() || time.Since(m.Failed) > captureRetryAfter {
		return
	}
	s.wdBroken.Store(true)
	s.wdNote.Store(s.captureFallbackNote())
}

// noteCaptureFailure records a failed open for later launches.
func (s *Service) noteCaptureFailure(err error) {
	m, _ := s.loadCaptureMemo()
	build := currentBuild()
	if m.Build != build {
		m = captureMemo{Build: build}
	}
	m.Failed = time.Now()
	m.Count++
	m.Err = err.Error()
	s.saveCaptureMemo(m)
}
