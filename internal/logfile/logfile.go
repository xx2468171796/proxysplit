// Package logfile keeps the client's maintenance log on disk: one file per
// local day (<config>/logs/proxysplit-YYYY-MM-DD.log), every line redacted with
// the telemetry sanitiser, each day capped at MaxDayBytes, files older than the
// retention window deleted at startup and once a day.
package logfile

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/telemetry"
)

const (
	// MaxDayBytes caps a single day file; past it one marker line is written
	// and the rest of that day is dropped.
	MaxDayBytes = 50 << 20
	// DefaultDays is the retention used when the setting is unset.
	DefaultDays = 7
	filePrefix  = "proxysplit-"
	fileSuffix  = ".log"
	capMarker   = "日志已达当天 50 MB 上限，今天后面的日志不再写入文件"
)

// FileName is the day file name for t's local date.
func FileName(t time.Time) string { return filePrefix + t.Format(time.DateOnly) + fileSuffix }

// ClampDays maps the setting to the supported 1–30 range (0 / unset = 7).
func ClampDays(n int) int {
	switch {
	case n <= 0:
		return DefaultDays
	case n > 30:
		return 30
	}
	return n
}

// Prune deletes day files whose date is outside the last `days` local days
// (today included). Files that do not match the naming scheme are left alone.
func Prune(dir string, now time.Time, days int) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	y, m, d := now.Date()
	keepFrom := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(ClampDays(days) - 1))
	removed := 0
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, filePrefix) || !strings.HasSuffix(name, fileSuffix) {
			continue
		}
		date, err := time.ParseInLocation(time.DateOnly, strings.TrimSuffix(strings.TrimPrefix(name, filePrefix), fileSuffix), now.Location())
		if err != nil || !date.Before(keepFrom) {
			continue
		}
		if os.Remove(filepath.Join(dir, name)) == nil {
			removed++
		}
	}
	return removed
}

// FormatLine renders "2026-10-29 14:03:12.345 INFO  [service] text\n" with the
// text redacted. Lines without a leading [category] come from the core.
func FormatLine(t time.Time, line string) string {
	text := maskPhones(telemetry.Sanitize(strings.TrimRight(line, "\r\n")))
	if !strings.HasPrefix(text, "[") {
		text = "[core] " + text
	}
	return fmt.Sprintf("%s %-5s %s\n", t.Format("2006-01-02 15:04:05.000"), Level(text), text)
}

// Level guesses a level from the line text (sing-box prints its own level word).
func Level(text string) string {
	up := strings.ToUpper(text)
	switch {
	case strings.Contains(up, "FATAL") || strings.Contains(up, "PANIC") || strings.Contains(up, "ERROR") ||
		strings.Contains(up, " FAILED") || strings.Contains(up, "失败"):
		return "ERROR"
	case strings.Contains(up, "WARN"):
		return "WARN"
	case strings.Contains(up, "DEBUG") || strings.Contains(up, "TRACE"):
		return "DEBUG"
	}
	return "INFO"
}
