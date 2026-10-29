package logfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRotateAtMidnight(t *testing.T) {
	dir := t.TempDir()
	clk := &fakeClock{time.Date(2026, 10, 29, 23, 59, 59, 0, time.Local)}
	w := newWriter(dir, clk.now, nil)
	w.Write("[service] before midnight")
	clk.t = clk.t.Add(2 * time.Second)
	w.Write("[service] after midnight")
	w.Close()
	a := read(t, filepath.Join(dir, "proxysplit-2026-10-29.log"))
	b := read(t, filepath.Join(dir, "proxysplit-2026-10-30.log"))
	if !strings.Contains(a, "before midnight") || strings.Contains(a, "after") {
		t.Fatalf("day 1: %q", a)
	}
	if !strings.HasPrefix(b, "2026-10-30 00:00:01.000 INFO  [service] after midnight") {
		t.Fatalf("day 2: %q", b)
	}
}

func TestDayCap(t *testing.T) {
	dir := t.TempDir()
	clk := &fakeClock{time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)}
	w := newWriter(dir, clk.now, nil)
	w.maxBytes = 200
	for range 20 {
		w.Write("[core] some line that is long enough to fill")
	}
	w.Close()
	got := read(t, filepath.Join(dir, "proxysplit-2026-10-29.log"))
	if strings.Count(got, capMarker) != 1 || !strings.HasSuffix(strings.TrimSpace(got), capMarker) {
		t.Fatalf("want one trailing marker: %q", got)
	}
	// Reopening the same day stays capped.
	w = newWriter(dir, clk.now, nil)
	w.maxBytes = 200
	w.Write("[core] more")
	w.Close()
	if strings.Contains(read(t, filepath.Join(dir, "proxysplit-2026-10-29.log")), "more") {
		t.Fatal("wrote past the cap after reopen")
	}
}

func TestPrune(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"2026-10-20", "2026-10-22", "2026-10-23", "2026-10-29", "bad-date"} {
		if err := os.WriteFile(filepath.Join(dir, "proxysplit-"+n+".log"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "other.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 29, 8, 0, 0, 0, time.Local)
	if n := Prune(dir, now, 7); n != 2 { // keeps 10-23 … 10-29
		t.Fatalf("removed %d", n)
	}
	left, _ := os.ReadDir(dir)
	if len(left) != 4 {
		t.Fatalf("left %d files", len(left))
	}
	if n := Prune(dir, now, 1); n != 1 { // only today survives (10-23 goes)
		t.Fatalf("days=1 removed %d", n)
	}
}

func TestRetentionRunsOnRotate(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "proxysplit-2026-10-01.log")
	if err := os.WriteFile(old, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	clk := &fakeClock{time.Date(2026, 10, 29, 9, 0, 0, 0, time.Local)}
	w := newWriter(dir, clk.now, func() int { return 7 })
	w.Write("[service] hello")
	w.Close()
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old file not pruned")
	}
}

func TestClampDays(t *testing.T) {
	for in, want := range map[int]int{0: 7, -3: 7, 1: 1, 15: 15, 30: 30, 99: 30} {
		if got := ClampDays(in); got != want {
			t.Errorf("ClampDays(%d)=%d want %d", in, got, want)
		}
	}
}

func TestFormatRedacts(t *testing.T) {
	ts := time.Date(2026, 10, 29, 14, 3, 12, 345e6, time.Local)
	got := FormatLine(ts, "[account] login 13812345678 token=abcdef vless://uuid@host:443 failed")
	for _, bad := range []string{"13812345678", "abcdef", "uuid@host"} {
		if strings.Contains(got, bad) {
			t.Fatalf("leaked %q: %s", bad, got)
		}
	}
	if !strings.Contains(got, "138******78") || !strings.HasPrefix(got, "2026-10-29 14:03:12.345 ERROR [account]") {
		t.Fatalf("format: %s", got)
	}
	if !strings.Contains(FormatLine(ts, "INFO[0000] dns: ready"), "INFO  [core] INFO[0000]") {
		t.Fatal("core category missing")
	}
}
