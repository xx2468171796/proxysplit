// Package download is the one resumable HTTP download used by the app updater
// and the core installer: it appends to a partial file with a Range request,
// has no overall deadline (a large file on a slow line must be able to finish)
// and is policed by a progress watchdog instead.
package download

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// DefaultWindow is the watchdog window when Request.Window is zero.
const DefaultWindow = 30 * time.Second

// Per-phase limits for a download transport (WithPhaseTimeouts). The body has
// none: the watchdog decides.
const (
	dialTimeout   = 15 * time.Second
	tlsTimeout    = 15 * time.Second
	headerTimeout = 30 * time.Second
)

// ErrTooSlow is wrapped by Resume when the watchdog aborted the transfer.
var ErrTooSlow = errors.New("下载中断")

// Request describes one download attempt.
type Request struct {
	Client    *http.Client // must have no overall Timeout
	URL       string
	Path      string // partial file: appended to, created when missing
	MaxBytes  int64  // cap on the whole file (0 = none)
	UserAgent string
	// The watchdog aborts when fewer than MinBPS bytes per second arrived over
	// a Window. MinBPS 0 = a pure stall watchdog: abort only when nothing at
	// all arrived (a slow but moving transfer is left to finish).
	Window time.Duration
	MinBPS int
}

// WithPhaseTimeouts bounds connecting, the TLS handshake and waiting for the
// response headers on t (a dialer already set — a proxy — is kept) and returns
// it. Use it with a client that has no overall Timeout.
func WithPhaseTimeouts(t *http.Transport) *http.Transport {
	if t.DialContext == nil {
		t.DialContext = (&net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}).DialContext
	}
	t.TLSHandshakeTimeout = tlsTimeout
	t.ResponseHeaderTimeout = headerTimeout
	return t
}

// Resume appends r.URL's content to r.Path, asking for `Range: bytes=<size>-`
// when the file is not empty, and returns the offset the transfer actually
// continued from. A 200 answer (the server ignored Range) restarts the file
// and returns 0; a 206 must continue exactly at size. On an error the partial
// file is kept for the next attempt, except when it cannot be continued (a
// mismatching or unsatisfiable range), where it is emptied.
func Resume(ctx context.Context, r Request) (from int64, err error) {
	f, err := os.OpenFile(r.Path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var got atomic.Int64
	var slow atomic.Bool
	window := r.Window
	if window <= 0 {
		window = DefaultWindow
	}
	go watch(ctx, cancel, &got, &slow, window, r.MinBPS)
	wrap := func(err error) error {
		switch {
		case !slow.Load():
			return fmt.Errorf("download %q: %w", r.URL, err)
		case r.MinBPS > 0:
			return fmt.Errorf("download %q: %w：速度过慢（低于 %d KB/s 持续 %v）", r.URL, ErrTooSlow, r.MinBPS/1000, window)
		}
		return fmt.Errorf("download %q: %w：%v 内没有收到数据", r.URL, ErrTooSlow, window)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	if r.UserAgent != "" {
		req.Header.Set("User-Agent", r.UserAgent)
	}
	if size > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", size))
	}
	resp, err := r.Client.Do(req)
	if err != nil {
		return 0, wrap(err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// Server ignored Range (or nothing to resume): start over.
		if err := f.Truncate(0); err != nil {
			return 0, err
		}
		size = 0
	case http.StatusPartialContent:
		if start, ok := contentRangeStart(resp.Header.Get("Content-Range")); !ok || start != size {
			_ = f.Truncate(0)
			return 0, fmt.Errorf("download %q: 续传位置不符（%q）", r.URL, resp.Header.Get("Content-Range"))
		}
	case http.StatusRequestedRangeNotSatisfiable:
		_ = f.Truncate(0)
		return 0, fmt.Errorf("download %q: unexpected status %s", r.URL, resp.Status)
	default:
		return 0, fmt.Errorf("download %q: unexpected status %s", r.URL, resp.Status)
	}
	if r.MaxBytes > 0 && resp.ContentLength > 0 && size+resp.ContentLength > r.MaxBytes {
		return size, fmt.Errorf("download %q: exceeds %d bytes", r.URL, r.MaxBytes)
	}
	if _, err := f.Seek(size, io.SeekStart); err != nil {
		return size, err
	}
	if _, err := io.Copy(&countingWriter{w: f, n: &got, total: size, max: r.MaxBytes}, resp.Body); err != nil {
		return size, wrap(err)
	}
	return size, nil
}

// watch cancels the transfer when it made too little progress over a window.
func watch(ctx context.Context, cancel context.CancelFunc, got *atomic.Int64, slow *atomic.Bool, window time.Duration, minBPS int) {
	need := int64(float64(minBPS) * window.Seconds())
	if need < 1 {
		need = 1
	}
	t := time.NewTicker(window)
	defer t.Stop()
	last := got.Load()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cur := got.Load()
			if cur-last < need {
				slow.Store(true)
				cancel()
				return
			}
			last = cur
		}
	}
}

type countingWriter struct {
	w     io.Writer
	n     *atomic.Int64
	total int64 // bytes already in the file
	max   int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	if c.max > 0 && c.total+int64(len(p)) > c.max {
		return 0, fmt.Errorf("exceeds %d bytes", c.max)
	}
	n, err := c.w.Write(p)
	c.total += int64(n)
	c.n.Add(int64(n))
	return n, err
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
