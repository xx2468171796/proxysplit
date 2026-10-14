package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// syncClashMode makes the running core use opts.ClashMode. With a cache file
// the core boots in the 代理策略 it last ran with and ignores default_mode, so
// a mode chosen while it was stopped would otherwise be lost. Waits up to 10 s
// for the clash API; no-op without one.
func (m *Manager) syncClashMode(opts Options) {
	if opts.ClashController == "" || opts.CacheFile == "" {
		return
	}
	want := opts.ClashMode
	if want == "" {
		want = "rule"
	}
	changed, err := EnsureClashMode(opts.ClashController, opts.ClashSecret, want, 10*time.Second)
	switch {
	case err != nil:
		m.onLog(fmt.Sprintf("[core] 代理策略同步失败：%v", err))
	case changed:
		m.onLog(fmt.Sprintf("[core] 代理策略已按设置改回 %s", want))
	}
}

// EnsureClashMode waits for the clash API at controller and switches it to
// mode if it runs another one. changed reports whether a switch was needed.
func EnsureClashMode(controller, secret, mode string, wait time.Duration) (changed bool, err error) {
	cl := &http.Client{Timeout: 2 * time.Second}
	do := func(method, body string) (*http.Response, error) {
		req, err := http.NewRequest(method, "http://"+controller+"/configs", strings.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		}
		return cl.Do(req)
	}
	deadline := time.Now().Add(wait)
	var cur struct {
		Mode string `json:"mode"`
	}
	for {
		resp, gerr := do(http.MethodGet, "")
		if gerr == nil {
			derr := json.NewDecoder(resp.Body).Decode(&cur)
			resp.Body.Close()
			if derr != nil {
				return false, derr
			}
			break
		}
		if time.Now().After(deadline) {
			return false, gerr
		}
		time.Sleep(50 * time.Millisecond)
	}
	if strings.EqualFold(cur.Mode, mode) {
		return false, nil
	}
	body, _ := json.Marshal(map[string]string{"mode": mode})
	resp, err := do(http.MethodPatch, string(bytes.TrimSpace(body)))
	if err != nil {
		return false, err
	}
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return false, fmt.Errorf("clash API %s", resp.Status)
	}
	return true, nil
}
