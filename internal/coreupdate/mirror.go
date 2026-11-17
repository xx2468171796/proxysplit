package coreupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/download"
)

// Multi-source download (docs/platform/下载镜像加速.md §3). The panel announces
// mirrors in front and the origin last; we probe the mirrors, then download into
// ONE temp file, resuming across candidates (the content is identical, so a
// Range continuation from another mirror is valid). The origin is always the
// very last candidate and keeps the old "direct, then through the node" retry.
// Every candidate's result is sha256-verified; a mismatch deletes the temp file
// and moves on.
//
// These are variables only so tests can shrink the timings.
var (
	probeBytes   int64 = 256 << 10 // curl -r 0-262143
	probeTimeout       = 6 * time.Second
	slowWindow         = 20 * time.Second // watchdog window (curl --speed-time 20)
	slowMinBPS         = 30000            // mirrors: curl --speed-limit 30000 (bytes/s); the origin only has to keep moving
)

var errSHAMismatch = errors.New("内核文件 SHA256 校验失败")

// candidateURLs returns the mirror URLs to try before the origin: http(s)
// only, de-duplicated, never the origin itself (it is always tried last).
func candidateURLs(urls []string, origin string) []string {
	seen := map[string]bool{origin: true}
	var out []string
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || seen[raw] {
			continue
		}
		seen[raw] = true
		out = append(out, raw)
	}
	return out
}

// directClient is a plain client without an overall timeout: connecting and
// the response headers are bounded, the body is policed by the watchdog.
func directClient() *http.Client {
	return &http.Client{Transport: download.WithPhaseTimeouts(&http.Transport{})}
}

// orderByProbe races a small ranged GET against every mirror and returns them
// fastest first. Mirrors that fail the probe keep the panel order after the
// ones that answered.
func orderByProbe(mirrors []string) []string {
	if len(mirrors) < 2 {
		return mirrors
	}
	client := directClient()
	defer client.CloseIdleConnections()
	speeds := make([]float64, len(mirrors))
	var wg sync.WaitGroup
	for i, m := range mirrors {
		wg.Add(1)
		go func(i int, m string) {
			defer wg.Done()
			speeds[i] = probeSpeed(client, m)
		}(i, m)
	}
	wg.Wait()
	idx := make([]int, len(mirrors))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return speeds[idx[a]] > speeds[idx[b]] })
	out := make([]string, len(mirrors))
	for i, j := range idx {
		out[i] = mirrors[j]
	}
	return out
}

// probeSpeed returns bytes/second of a ranged GET of the first probeBytes, 0 on failure.
func probeSpeed(client *http.Client, rawurl string) float64 {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawurl, nil)
	if err != nil {
		return 0
	}
	req.Header.Set("User-Agent", "ProxySplit")
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", probeBytes-1))
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return 0
	}
	n, _ := io.Copy(io.Discard, io.LimitReader(resp.Body, probeBytes))
	if n <= 0 {
		return 0
	}
	elapsed := time.Since(start)
	if elapsed < time.Millisecond {
		elapsed = time.Millisecond
	}
	return float64(n) / elapsed.Seconds()
}

// fetchMultiSource downloads the artifact trying mirrors (fastest first), then
// the origin (direct, then viaProxy). Returns the sha256-verified body.
func fetchMultiSource(destDir string, mirrors []string, origin, expected, viaProxy string) ([]byte, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(destDir, "core-dl-*.tmp")
	if err != nil {
		return nil, err
	}
	tmp := f.Name()
	_ = f.Close()
	defer os.Remove(tmp)

	var lastErr error
	client := directClient()
	defer client.CloseIdleConnections()
	for _, m := range orderByProbe(mirrors) {
		body, err := tryCandidate(client, m, tmp, expected, slowMinBPS)
		if err == nil {
			return body, nil
		}
		lastErr = err
	}

	// Origin: direct first, then through the node. The last resort is never
	// given up for being slow, only for standing still (stall watchdog) — it
	// used to run with no timeout and no watchdog at all, so one dead
	// connection hung the install for good.
	oc, err := downloadClient("")
	if err != nil {
		return nil, err
	}
	defer oc.CloseIdleConnections()
	body, err := tryCandidate(oc, origin, tmp, expected, 0)
	if err != nil && !errors.Is(err, errSHAMismatch) && viaProxy != "" {
		pc, perr := downloadClient(viaProxy)
		if perr == nil {
			defer pc.CloseIdleConnections()
			body, err = tryCandidate(pc, origin, tmp, expected, 0)
		}
	}
	if err == nil {
		return body, nil
	}
	if lastErr != nil && !errors.Is(err, errSHAMismatch) {
		return nil, fmt.Errorf("%w（镜像也失败：%v）", err, lastErr)
	}
	return nil, err
}

// tryCandidate resumes the download of rawurl into tmp and verifies sha256.
// On a hash mismatch the temp file is emptied so the next candidate starts
// clean — and when this download had continued a partial file left by another
// source (the bad bytes may be theirs), it is retried once from offset 0.
// minBPS is the watchdog's speed floor (0 = abort only on a stall).
func tryCandidate(client *http.Client, rawurl, tmp, expected string, minBPS int) ([]byte, error) {
	for attempt := 0; ; attempt++ {
		from, err := download.Resume(context.Background(), download.Request{Client: client, URL: rawurl, Path: tmp,
			MaxBytes: maxZipBytes, UserAgent: "ProxySplit", Window: slowWindow, MinBPS: minBPS})
		if err != nil {
			return nil, err
		}
		body, err := os.ReadFile(tmp)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(body)
		if hex.EncodeToString(sum[:]) == expected {
			return body, nil
		}
		_ = os.Truncate(tmp, 0)
		if from == 0 || attempt > 0 {
			return nil, fmt.Errorf("%s: %w", rawurl, errSHAMismatch)
		}
	}
}
