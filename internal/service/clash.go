package service

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// clashModes are the runtime routing modes exposed via sing-box's clash_api.
// "rule" honours the per-line/route rules, "global" forces everything through
// the node, "direct" forces everything direct — switchable without a restart.
var clashModes = map[string]bool{"rule": true, "global": true, "direct": true}

// genSecret returns a random bearer token for the clash_api controller.
func genSecret() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "proxysplit"
	}
	return hex.EncodeToString(b)
}

// GetClashMode returns the current runtime mode (rule|global|direct).
func (s *Service) GetClashMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clashMode == "" {
		return "rule"
	}
	return s.clashMode
}

// SetClashMode switches the runtime routing mode live (no restart) and persists
// it so it survives restarts. When the core is running it PATCHes clash_api
// immediately; otherwise the mode is stored and baked into the next Start's
// config (experimental.clash_api.default_mode).
func (s *Service) SetClashMode(mode string) error {
	if !clashModes[mode] {
		return fmt.Errorf("invalid mode %q", mode)
	}
	s.mu.Lock()
	s.clashMode = mode
	s.cfg.ClashMode = mode
	s.save()
	port := s.clashPort
	secret := s.clashSecret
	running := s.core.Running()
	s.mu.Unlock()

	if !running || port == 0 {
		// Not running: the mode is stored and applied when the core next starts.
		return nil
	}
	if err := putClashMode(port, secret, mode); err != nil {
		return fmt.Errorf("switch mode: %w", err)
	}
	s.log(fmt.Sprintf("[clash] mode -> %s", mode))
	return nil
}

// putClashMode issues the clash_api PATCH /configs {"mode":...} call.
func putClashMode(port int, secret, mode string) error {
	body, _ := json.Marshal(map[string]string{"mode": mode})
	url := fmt.Sprintf("http://127.0.0.1:%d/configs", port)
	req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	cl := &http.Client{Timeout: 3 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("clash_api status %d", resp.StatusCode)
	}
	return nil
}
