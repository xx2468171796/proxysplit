package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type reqLog struct {
	mu sync.Mutex
	v  []string
}

func (l *reqLog) add(s string) { l.mu.Lock(); l.v = append(l.v, s); l.mu.Unlock() }
func (l *reqLog) all() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.v...)
}

const probeRange = "bytes=0-262143"

// fastTimings shrinks the stall watchdog for tests.
func fastTimings(t *testing.T) {
	t.Helper()
	w, b := slowWindow, slowMinBPS
	slowWindow, slowMinBPS = 300*time.Millisecond, 30000
	t.Cleanup(func() { slowWindow, slowMinBPS = w, b })
}

func testExe() ([]byte, string) {
	exe := append(append([]byte(nil), exeMagic...), bytes.Repeat([]byte("sing-box!"), (minExeBytes+4096)/9+1)...)
	sum := sha256.Sum256(exe)
	return exe, hex.EncodeToString(sum[:])
}

// mirror serves exe via ServeContent (Range aware); probeDelay orders probe speeds.
func mirror(log *reqLog, name string, probeDelay time.Duration, exe []byte) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rg := r.Header.Get("Range")
		if rg == probeRange {
			time.Sleep(probeDelay)
		} else {
			log.add(name + " " + rg)
		}
		http.ServeContent(w, r, "core.exe", time.Time{}, bytes.NewReader(exe))
	}))
}

func TestInstallReleaseMirrorsBadShaStallThenGood(t *testing.T) {
	fastTimings(t)
	exe, sum := testExe()
	log := &reqLog{}

	bad := bytes.Repeat([]byte{'X'}, len(exe))
	copy(bad, exeMagic)
	badSrv := mirror(log, "bad", 0, bad) // answers probes first
	defer badSrv.Close()

	// Stalls after 300000 correct bytes (declares the full length, then hangs).
	stall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") == probeRange {
			time.Sleep(150 * time.Millisecond)
			http.ServeContent(w, r, "core.exe", time.Time{}, bytes.NewReader(exe))
			return
		}
		log.add("stall " + r.Header.Get("Range"))
		w.Header().Set("Content-Length", "99999999")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(exe[:300000])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer stall.Close()

	good := mirror(log, "good", 400*time.Millisecond, exe)
	defer good.Close()

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("origin " + r.Header.Get("Range"))
		w.WriteHeader(500)
	}))
	defer origin.Close()

	dir := t.TempDir()
	v, err := InstallRelease(dir, "1.14.1", Release{
		Version: "1.14.2-relayops.6", URL: origin.URL,
		URLs: []string{badSrv.URL, stall.URL, good.URL, "ftp://nope/x", origin.URL}, SHA256: sum,
	}, "")
	if err != nil || v != "1.14.2-relayops.6" {
		t.Fatalf("install: %q %v (log %v)", v, err, log.all())
	}
	got := log.all()
	want := []string{"bad ", "stall ", "good bytes=300000-"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("request order/resume: got %v want %v", got, want)
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "core-dl-*.tmp")); len(m) != 0 {
		t.Fatalf("temp file left behind: %v", m)
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.6" {
		t.Fatalf("marker %q", got)
	}
}

func TestInstallReleaseOriginAlwaysLast(t *testing.T) {
	exe, sum := testExe()
	log := &reqLog{}
	down := func(name string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Range") != probeRange {
				log.add(name)
			}
			w.WriteHeader(503)
		}))
	}
	m1, m2 := down("m1"), down("m2")
	defer m1.Close()
	defer m2.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("origin")
		_, _ = w.Write(exe)
	}))
	defer origin.Close()

	// Origin listed FIRST by the panel must still be tried last.
	v, err := InstallRelease(t.TempDir(), "", Release{Version: "1.14.2-relayops.6", URL: origin.URL,
		URLs: []string{origin.URL, m1.URL, m2.URL}, SHA256: sum}, "")
	if err != nil || v == "" {
		t.Fatal(v, err)
	}
	got := log.all()
	if len(got) != 3 || got[2] != "origin" || got[0] == "origin" || got[1] == "origin" {
		t.Fatalf("order %v", got)
	}
}

func TestInstallReleaseMirrorIgnoresRangeRestarts(t *testing.T) {
	fastTimings(t)
	exe, sum := testExe()
	stall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") == probeRange {
			http.ServeContent(w, r, "x", time.Time{}, bytes.NewReader(exe))
			return
		}
		w.Header().Set("Content-Length", "99999999")
		_, _ = w.Write(exe[:200000])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer stall.Close()
	var second string
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") == probeRange {
			time.Sleep(300 * time.Millisecond)
		} else {
			second = r.Header.Get("Range")
		}
		_, _ = w.Write(exe) // always 200: ignores Range
	}))
	defer plain.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	defer origin.Close()

	if _, err := InstallRelease(t.TempDir(), "", Release{Version: "1.14.2-relayops.6", URL: origin.URL,
		URLs: []string{stall.URL, plain.URL}, SHA256: sum}, ""); err != nil {
		t.Fatal(err)
	}
	if second != "bytes=200000-" {
		t.Fatalf("second mirror was asked %q", second)
	}
}

func TestInstallReleaseAllBadShaFails(t *testing.T) {
	exe, _ := testExe()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(exe) }))
	defer srv.Close()
	dir := t.TempDir()
	_, err := InstallRelease(dir, "", Release{Version: "1.14.2-relayops.6", URL: srv.URL,
		URLs: []string{srv.URL + "/m"}, SHA256: strings.Repeat("0", 64)}, "")
	if err == nil || !strings.Contains(err.Error(), "SHA256") {
		t.Fatalf("want sha error, got %v", err)
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "core-dl-*.tmp")); len(m) != 0 {
		t.Fatalf("temp file left behind: %v", m)
	}
}

func TestInstallReleaseNoURLsOldBehaviour(t *testing.T) {
	exe, sum := testExe()
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("Range") != "" {
			t.Errorf("old path must not send Range: %q", r.Header.Get("Range"))
		}
		_, _ = w.Write(exe)
	}))
	defer srv.Close()
	dir := t.TempDir()
	// URLs holding only the origin / junk counts as "no mirrors".
	for _, urls := range [][]string{nil, {srv.URL}, {"ftp://x/y", ""}} {
		if _, err := InstallRelease(dir, "", Release{Version: "1.14.2-relayops.6", URL: srv.URL, URLs: urls, SHA256: sum}, ""); err != nil {
			t.Fatal(err)
		}
		_ = ClearBackup(dir)
	}
	if hits != 3 {
		t.Fatalf("hits=%d", hits)
	}
}

func TestCandidateURLs(t *testing.T) {
	got := candidateURLs([]string{" https://a/x ", "ftp://b/x", "https://a/x", "http://o/x", "", "notaurl", "http://c/x"}, "http://o/x")
	if strings.Join(got, ",") != "https://a/x,http://c/x" {
		t.Fatalf("%v", got)
	}
}

// The origin is the last resort and used to run with no timeout and no
// watchdog: a connection that went quiet hung the install (and everything
// waiting for installMu) for good. It must be given up when it stands still.
func TestInstallReleaseOriginStallIsAborted(t *testing.T) {
	fastTimings(t)
	exe, sum := testExe()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "99999999")
		_, _ = w.Write(exe[:100000])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer origin.Close()
	done := make(chan error, 1)
	go func() {
		_, err := InstallRelease(t.TempDir(), "", Release{Version: "1.14.2-relayops.6", URL: origin.URL, SHA256: sum}, "")
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "没有收到数据") {
			t.Fatalf("want a stall error, got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("a stalled origin download was never given up")
	}
}

// The origin only has to keep moving: slower than the mirrors' speed floor is
// fine (it is the last source there is).
func TestInstallReleaseSlowOriginFinishes(t *testing.T) {
	fastTimings(t)
	exe, sum := testExe()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		half := len(exe) / 2
		_, _ = w.Write(exe[:half])
		w.(http.Flusher).Flush()
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write(exe[half : half+1000]) // ~5 KB/s over this window: under the mirror floor
		w.(http.Flusher).Flush()
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write(exe[half+1000:])
	}))
	defer origin.Close()
	if _, err := InstallRelease(t.TempDir(), "", Release{Version: "1.14.2-relayops.6", URL: origin.URL, SHA256: sum}, ""); err != nil {
		t.Fatalf("a slow but moving origin must finish: %v", err)
	}
}

// A candidate that continued somebody else's partial file and then fails the
// hash is retried once from offset 0: the bad bytes may be the other source's.
func TestInstallReleaseRetriesFromZeroAfterResumedMismatch(t *testing.T) {
	fastTimings(t)
	exe, sum := testExe()
	log := &reqLog{}
	// Sends 150000 WRONG bytes, then stalls.
	corrupt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") == probeRange {
			http.ServeContent(w, r, "x", time.Time{}, bytes.NewReader(exe))
			return
		}
		log.add("corrupt " + r.Header.Get("Range"))
		w.Header().Set("Content-Length", "99999999")
		_, _ = w.Write(bytes.Repeat([]byte{'Z'}, 150000))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer corrupt.Close()
	good := mirror(log, "good", 300*time.Millisecond, exe)
	defer good.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("origin")
		w.WriteHeader(500)
	}))
	defer origin.Close()

	if _, err := InstallRelease(t.TempDir(), "", Release{Version: "1.14.2-relayops.6", URL: origin.URL,
		URLs: []string{corrupt.URL, good.URL}, SHA256: sum}, ""); err != nil {
		t.Fatalf("install: %v (log %v)", err, log.all())
	}
	want := []string{"corrupt ", "good bytes=150000-", "good "}
	if got := log.all(); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("requests: got %v want %v", got, want)
	}
}

// The download must not hold installMu: Rollback / ClearBackup / the bundled
// core check wait for that lock and a download can take minutes.
func TestInstallReleaseDownloadsOutsideInstallLock(t *testing.T) {
	exe, sum := testExe()
	downloading, release := make(chan struct{}), make(chan struct{})
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(downloading)
		<-release
		_, _ = w.Write(exe)
	}))
	defer origin.Close()
	dir := t.TempDir()
	done := make(chan error, 1)
	go func() {
		_, err := InstallRelease(dir, "", Release{Version: "1.14.2-relayops.6", URL: origin.URL, SHA256: sum}, "")
		done <- err
	}()
	<-downloading
	locked := make(chan struct{})
	go func() {
		installMu.Lock()
		installMu.Unlock() //nolint:staticcheck // only probing that the lock is free
		close(locked)
	}()
	select {
	case <-locked:
	case <-time.After(3 * time.Second):
		t.Fatal("installMu is held while the artifact downloads")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
