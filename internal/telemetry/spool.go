package telemetry

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// record is one spooled line: an event (K="e") or a log line (K="l").
type record struct {
	K string `json:"k"`
	E *Event `json:"e,omitempty"`
	T int64  `json:"t,omitempty"` // log line time, unix ms
	S string `json:"s,omitempty"` // log line text (already sanitised)
}

// Spool is a size-capped directory of JSON-lines segments. Records go to the
// current segment "cur-<session>.jsonl"; Seal renames it to
// "seg-<unixnano>-<session>.jsonl" so the uploader can send and delete it.
// A crash leaves cur-* behind; the next Open seals it, so nothing is lost.
type Spool struct {
	mu       sync.Mutex
	dir      string
	session  string
	segLimit int64 // seal the current segment past this many bytes
	capBytes int64 // total bytes kept on disk; oldest sealed segments go first
	f        *os.File
	w        *bufio.Writer
	size     int64
	now      func() time.Time
}

// OpenSpool prepares dir and seals segments left by earlier runs.
func OpenSpool(dir, session string, segLimit, capBytes int64) (*Spool, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Spool{dir: dir, session: session, segLimit: segLimit, capBytes: capBytes, now: time.Now}
	leftovers, _ := filepath.Glob(filepath.Join(dir, "cur-*.jsonl"))
	for i, p := range leftovers {
		sess := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(p), "cur-"), ".jsonl")
		_ = os.Rename(p, filepath.Join(dir, fmt.Sprintf("seg-%019d-%s.jsonl", s.now().UnixNano()+int64(i), sess)))
	}
	s.enforceCapLocked()
	return s, nil
}

func (s *Spool) curPath() string { return filepath.Join(s.dir, "cur-"+s.session+".jsonl") }

// Append writes one record; it seals the segment once it is large enough.
func (s *Spool) Append(r record) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.f == nil {
		f, err := os.OpenFile(s.curPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return err
		}
		st, _ := f.Stat()
		s.f, s.w, s.size = f, bufio.NewWriterSize(f, 32<<10), 0
		if st != nil {
			s.size = st.Size()
		}
	}
	n, err := s.w.Write(append(raw, '\n'))
	s.size += int64(n)
	if err != nil {
		return err
	}
	if s.size >= s.segLimit {
		return s.sealLocked()
	}
	return nil
}

// Flush pushes buffered records to the OS (survives an app crash).
func (s *Spool) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil {
		return nil
	}
	return s.w.Flush()
}

// Seal closes the current segment (if it has data) and makes it uploadable.
func (s *Spool) Seal() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sealLocked()
}

func (s *Spool) sealLocked() error {
	if s.f == nil {
		return nil
	}
	_ = s.w.Flush()
	_ = s.f.Close()
	s.f, s.w = nil, nil
	size := s.size
	s.size = 0
	if size == 0 {
		_ = os.Remove(s.curPath())
		return nil
	}
	dst := filepath.Join(s.dir, fmt.Sprintf("seg-%019d-%s.jsonl", s.now().UnixNano(), s.session))
	if err := os.Rename(s.curPath(), dst); err != nil {
		return err
	}
	s.enforceCapLocked()
	return nil
}

// Segments lists sealed segments, oldest first.
func (s *Spool) Segments() []string {
	list, _ := filepath.Glob(filepath.Join(s.dir, "seg-*.jsonl"))
	sort.Strings(list) // zero-padded unixnano: lexical order = time order
	return list
}

// enforceCapLocked deletes the oldest sealed segments until the spool fits.
func (s *Spool) enforceCapLocked() {
	list := s.Segments()
	var total int64
	sizes := make([]int64, len(list))
	for i, p := range list {
		if st, err := os.Stat(p); err == nil {
			sizes[i] = st.Size()
			total += st.Size()
		}
	}
	total += s.size
	for i := 0; i < len(list) && total > s.capBytes; i++ {
		if os.Remove(list[i]) == nil {
			total -= sizes[i]
		}
	}
}

// Close flushes and closes the current segment without sealing it (the next
// launch seals it).
func (s *Spool) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.f != nil {
		_ = s.w.Flush()
		_ = s.f.Close()
		s.f, s.w = nil, nil
	}
}

// readSegment parses one sealed segment; malformed lines (torn write at a
// crash) are skipped.
func readSegment(path string) ([]record, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []record
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var r record
		if json.Unmarshal(sc.Bytes(), &r) == nil && (r.K == "e" && r.E != nil || r.K == "l") {
			out = append(out, r)
		}
	}
	return out, sc.Err()
}

// segmentSession extracts the session id from a sealed segment name.
func segmentSession(path string) string {
	base := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	parts := strings.SplitN(base, "-", 3)
	if len(parts) == 3 {
		return parts[2]
	}
	return ""
}
