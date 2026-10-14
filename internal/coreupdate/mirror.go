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
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
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
	slowWindow         = 20 * time.Second // curl --speed-time 20
	slowMinBPS         = 30000            // curl --speed-limit 30000 (bytes/s)
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

// directClient is a plain client without the 5-minute overall timeout (large
// files over a slow mirror are policed by the speed watchdog instead).
func directClient() *http.Client {
	return &http.Client{Transport: &http.Transport{}}
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
		body, err := tryCandidate(client, m, tmp, expected, true)
		if err == nil {
			return body, nil
		}
		lastErr = err
	}

	// Origin: the old behaviour (5-minute client, direct first, then the node).
	oc, err := newClient("")
	if err != nil {
		return nil, err
	}
	defer oc.CloseIdleConnections()
	oc.Timeout = 0 // resumed pieces from mirrors make the old 5-minute cap meaningless
	body, err := tryCandidate(oc, origin, tmp, expected, false)
	if err != nil && !errors.Is(err, errSHAMismatch) && viaProxy != "" {
		pc, perr := newClient(viaProxy)
		if perr == nil {
			defer pc.CloseIdleConnections()
			pc.Timeout = 0
			body, err = tryCandidate(pc, origin, tmp, expected, false)
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
// On a hash mismatch the temp file is emptied so the next candidate starts clean.
func tryCandidate(client *http.Client, rawurl, tmp, expected string, watch bool) ([]byte, error) {
	if err := resumeDownload(client, rawurl, tmp, watch); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(tmp)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != expected {
		_ = os.Truncate(tmp, 0)
		return nil, fmt.Errorf("%s: %w", rawurl, errSHAMismatch)
	}
	return body, nil
}

type countingWriter struct {
	w     io.Writer
	n     *atomic.Int64
	total int64 // bytes already in the file
}

func (c *countingWriter) Write(p []byte) (int, error) {
	if c.total+int64(len(p)) > maxZipBytes {
		return 0, fmt.Errorf("release exceeds %d bytes", maxZipBytes)
	}
	n, err := c.w.Write(p)
	c.total += int64(n)
	c.n.Add(int64(n))
	return n, err
}

// resumeDownload appends rawurl's content to the file at path, asking for
// `Range: bytes=<size>-` when the file is not empty. A 200 answer restarts the
// file; a 206 must continue exactly at size. With watch, the transfer is
// aborted when it averages below slowMinBPS over a slowWindow.
func resumeDownload(client *http.Client, rawurl, path string, watch bool) error {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var got atomic.Int64
	var slow atomic.Bool
	if watch {
		go func() {
			t := time.NewTicker(slowWindow)
			defer t.Stop()
			last := got.Load()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					cur := got.Load()
					if float64(cur-last) < float64(slowMinBPS)*slowWindow.Seconds() {
						slow.Store(true)
						cancel()
						return
					}
					last = cur
				}
			}
		}()
	}
	wrap := func(err error) error {
		if slow.Load() {
			return fmt.Errorf("download %q: 速度过慢（低于 %d KB/s 持续 %v）", rawurl, slowMinBPS/1000, slowWindow)
		}
		return fmt.Errorf("download %q: %w", rawurl, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawurl, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")
	if size > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", size))
	}
	resp, err := client.Do(req)
	if err != nil {
		return wrap(err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// Server ignored Range (or nothing to resume): start over.
		if err := f.Truncate(0); err != nil {
			return err
		}
		size = 0
	case http.StatusPartialContent:
		if start, ok := contentRangeStart(resp.Header.Get("Content-Range")); !ok || start != size {
			_ = f.Truncate(0)
			return fmt.Errorf("download %q: 续传位置不符（%q）", rawurl, resp.Header.Get("Content-Range"))
		}
	case http.StatusRequestedRangeNotSatisfiable:
		_ = f.Truncate(0)
		return fmt.Errorf("download %q: unexpected status %s", rawurl, resp.Status)
	default:
		return fmt.Errorf("download %q: unexpected status %s", rawurl, resp.Status)
	}
	if _, err := f.Seek(size, io.SeekStart); err != nil {
		return err
	}
	if _, err := io.Copy(&countingWriter{w: f, n: &got, total: size}, resp.Body); err != nil {
		return wrap(err)
	}
	return nil
}

// contentRangeStart parses "bytes <start>-<end>/<total>".
func contentRangeStart(h string) (int64, bool) {
	h = strings.TrimSpace(h)
	if !strings.HasPrefix(h, "bytes ") {
		return 0, false
	}
	rest := strings.TrimPrefix(h, "bytes ")
	dash := strings.IndexByte(rest, '-')
	if dash <= 0 {
		return 0, false
	}
	start, err := strconv.ParseInt(rest[:dash], 10, 64)
	return start, err == nil && start >= 0
}
