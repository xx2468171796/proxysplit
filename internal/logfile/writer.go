package logfile

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// flushAt forces a flush once this much is buffered (normally the 2 s tick).
const flushAt = 64 << 10

// Writer is a buffered, mutex-protected daily log file. Lines are kept in
// memory and appended with open → write → close on each flush, so no file
// handle is held (Windows would lock the file against the user's editor and
// against deletion). Build it with Open (production) or newWriter (tests).
type Writer struct {
	dir      string
	now      func() time.Time
	days     func() int
	maxBytes int64

	mu       sync.Mutex
	buf      bytes.Buffer
	day      string // local date the buffer belongs to
	size     int64  // bytes of that day's file, including the buffer
	capped   bool
	closed   bool
	prunedOn string // local date of the last retention pass
	quit     chan struct{}
	done     chan struct{}
}

func newWriter(dir string, now func() time.Time, days func() int) *Writer {
	if days == nil {
		days = func() int { return DefaultDays }
	}
	return &Writer{dir: dir, now: now, days: days, maxBytes: MaxDayBytes}
}

// Open starts the writer in dir with a background flusher (every 2 s) that also
// runs the daily retention pass. days is read on every pass, so a settings
// change takes effect without restart. Close flushes and stops it.
func Open(dir string, days func() int) *Writer {
	w := newWriter(dir, time.Now, days)
	w.quit, w.done = make(chan struct{}), make(chan struct{})
	w.mu.Lock()
	w.pruneLocked()
	w.mu.Unlock()
	go w.loop(2 * time.Second)
	return w
}

func (w *Writer) loop(every time.Duration) {
	defer close(w.done)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-w.quit:
			return
		case <-t.C:
			w.tick()
		}
	}
}

// tick flushes the buffer and runs retention when the local date changed.
func (w *Writer) tick() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.flushLocked()
	if w.now().Format(time.DateOnly) != w.prunedOn {
		w.pruneLocked()
	}
}

// Write records one log line (sanitised, timestamped, level-prefixed).
func (w *Writer) Write(line string) {
	if w == nil || strings.TrimSpace(line) == "" {
		return
	}
	now := w.now()
	text := FormatLine(now, line)
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	w.rotateLocked(now)
	if w.capped {
		return
	}
	if w.size+int64(len(text)) > w.maxBytes {
		w.capped = true
		text = FormatLine(now, "[logfile] "+capMarker)
	}
	w.buf.WriteString(text)
	w.size += int64(len(text))
	if w.buf.Len() >= flushAt {
		w.flushLocked()
	}
}

// rotateLocked switches to now's local day: flush the old day, read the new
// day's existing size (a restart may already have filled or capped it).
func (w *Writer) rotateLocked(now time.Time) {
	day := now.Format(time.DateOnly)
	if day == w.day {
		return
	}
	w.flushLocked()
	w.day, w.size, w.capped = day, 0, false
	if st, err := os.Stat(w.path()); err == nil {
		w.size = st.Size()
		w.capped = w.size >= w.maxBytes
	}
	if w.prunedOn != day {
		w.pruneLocked()
	}
}

func (w *Writer) path() string { return filepath.Join(w.dir, filePrefix+w.day+fileSuffix) }

// flushLocked appends the buffer to the current day file. On failure the
// buffer is dropped: the log must never grow memory without bound.
func (w *Writer) flushLocked() {
	if w.buf.Len() == 0 || w.day == "" {
		return
	}
	defer w.buf.Reset()
	if err := os.MkdirAll(w.dir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(w.path(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(w.buf.Bytes())
	_ = f.Close()
}

func (w *Writer) pruneLocked() {
	w.prunedOn = w.now().Format(time.DateOnly)
	Prune(w.dir, w.now(), w.days())
}

// PruneNow runs the retention pass immediately (after the setting changed).
func (w *Writer) PruneNow() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pruneLocked()
}

// Flush writes buffered lines to disk.
func (w *Writer) Flush() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.flushLocked()
}

// Close flushes and stops the flusher; later writes are dropped. Call once.
func (w *Writer) Close() {
	if w == nil {
		return
	}
	if w.quit != nil {
		close(w.quit)
		<-w.done
		w.quit = nil
	}
	w.mu.Lock()
	w.flushLocked()
	w.closed = true
	w.mu.Unlock()
}

// Dir is the folder holding the day files.
func (w *Writer) Dir() string { return w.dir }
