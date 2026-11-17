package telemetry

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Meta is the per-upload device context (read fresh for every batch: the
// core version and the signed-in account change at runtime).
type Meta struct {
	DeviceID    string `json:"deviceId"`
	AppVersion  string `json:"appVersion"`
	CoreVersion string `json:"coreVersion,omitempty"`
	OS          string `json:"os,omitempty"`
	Arch        string `json:"arch,omitempty"`
	AccountHint string `json:"accountHint,omitempty"`
}

// LogChunk is a contiguous run of log lines from one session.
type LogChunk struct {
	ChunkID   string `json:"chunkId"`
	SessionID string `json:"sessionId"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
	LineCount int    `json:"lineCount"`
	Text      string `json:"text"`
}

// Batch is the upload body (before gzip).
type Batch struct {
	SchemaVersion int `json:"schemaVersion"`
	Meta
	Events []Event    `json:"events"`
	Logs   []LogChunk `json:"logs"`
}

// Uploader sends sealed spool segments, oldest first. Small segments share a
// request (mergeBytes / mergeSegments and the per-batch counts permitting).
type Uploader struct {
	Endpoint string
	Client   *http.Client
	Meta     func() Meta
	Token    func() string // bearer access token, "" when signed out
	MinWait  time.Duration // first backoff step
	MaxWait  time.Duration // backoff ceiling
	// Quarantine sets aside a segment the server keeps rejecting (Spool.Quarantine).
	Quarantine func(path string)

	mu        sync.Mutex // guards failures / nextAfter: Ready is asked from the recorder loop while a drain runs
	failures  int
	nextAfter time.Time
	now       func() time.Time
}

func (u *Uploader) clock() time.Time {
	if u.now != nil {
		return u.now()
	}
	return time.Now()
}

// Ready reports whether the backoff window has passed.
func (u *Uploader) Ready() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	return !u.clock().Before(u.nextAfter)
}

func (u *Uploader) succeeded() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.failures, u.nextAfter = 0, time.Time{}
}

// backoff schedules the next attempt: MinWait·2^n with ±20 % jitter, capped.
func (u *Uploader) backoff() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.failures++
	wait := u.MinWait << min(u.failures-1, 16)
	if wait > u.MaxWait || wait <= 0 {
		wait = u.MaxWait
	}
	jitter := time.Duration(float64(wait) * (0.8 + 0.4*rand.Float64()))
	u.nextAfter = u.clock().Add(jitter)
}

// outcome of one upload attempt.
type outcome int

const (
	accepted outcome = iota // 2xx: the server has it
	rejected                // 400 / 413: this content will never be accepted as it is
	retry                   // network error, 5xx, 429, …: try again later
)

func outcomeOf(status int, err error) outcome {
	switch {
	case err == nil && status/100 == 2:
		return accepted
	case status == http.StatusBadRequest || status == http.StatusRequestEntityTooLarge:
		return rejected
	}
	return retry
}

// part is one sealed segment prepared for upload.
type part struct {
	path   string
	size   int64
	events []Event
	chunks []LogChunk
	bad    bool // unreadable: can only be set aside
}

func loadPart(meta Meta, path string, strict bool) part {
	p := part{path: path}
	if st, err := os.Stat(path); err == nil {
		p.size = st.Size()
	}
	recs, err := readSegment(path)
	if os.IsNotExist(err) {
		return p // purged meanwhile: nothing left to send
	}
	if err != nil && len(recs) == 0 {
		p.bad = true
		return p
	}
	p.events, p.chunks = segmentParts(meta, path, recs, strict)
	return p
}

// nextGroup takes the oldest segments that fit one request together: file
// sizes within mergeBytes and event / chunk counts within the batch limits.
// The first segment always goes, whatever its size.
func nextGroup(meta Meta, segments []string) []part {
	var group []part
	var size int64
	events, chunks := 0, 0
	for _, path := range segments {
		p := loadPart(meta, path, false)
		fits := !p.bad && len(group) < mergeSegments && size+p.size <= mergeBytes &&
			events+len(p.events) <= limitBatchEvents && chunks+len(p.chunks) <= limitBatchLogs
		if len(group) > 0 && !fits {
			break
		}
		group = append(group, p)
		size, events, chunks = size+p.size, events+len(p.events), chunks+len(p.chunks)
		if p.bad {
			break
		}
	}
	return group
}

// Drain uploads sealed segments in at most max requests. It stops at the
// first failure that may pass later and backs off. Content the server rejects
// (400 / 413) is narrowed down: a merged request is repeated segment by
// segment, and a single rejected segment is sent once more with every field
// re-cut and unusable records dropped; if that is rejected too it is
// quarantined. So one bad segment never blocks the queue, never takes its
// neighbours with it, and is never silently deleted.
func (u *Uploader) Drain(ctx context.Context, segments []string, max int) (sent int) {
	meta := clampMeta(u.Meta())
	for requests := 0; len(segments) > 0; requests++ {
		if requests >= max || !u.Ready() {
			return sent
		}
		group := nextGroup(meta, segments)
		segments = segments[len(group):]
		res := u.send(ctx, meta, group)
		if res == rejected {
			n, stop := u.oneByOne(ctx, meta, group)
			sent += n
			if stop {
				return sent
			}
			continue
		}
		if res != accepted {
			u.backoff()
			return sent
		}
		for _, p := range group {
			_ = os.Remove(p.path)
		}
		sent += len(group)
		u.succeeded()
	}
	return sent
}

// oneByOne handles a rejected request: each of its segments alone (already
// tried when the request held just one), then strict, then quarantine.
func (u *Uploader) oneByOne(ctx context.Context, meta Meta, group []part) (sent int, stop bool) {
	for _, p := range group {
		res := rejected
		if len(group) > 1 {
			res = u.send(ctx, meta, []part{p})
		}
		if res == rejected {
			res = u.send(ctx, meta, []part{loadPart(meta, p.path, true)})
		}
		switch res {
		case accepted:
			_ = os.Remove(p.path)
			sent++
			u.succeeded()
		case rejected:
			u.setAside(p.path)
		default:
			u.backoff()
			return sent, true
		}
	}
	return sent, false
}

func (u *Uploader) setAside(path string) {
	if u.Quarantine != nil {
		u.Quarantine(path)
		return
	}
	quarantine(path)
}

// send uploads the parts as one request (more only when a single segment
// alone exceeds the per-batch counts).
func (u *Uploader) send(ctx context.Context, meta Meta, group []part) outcome {
	var events []Event
	var chunks []LogChunk
	for _, p := range group {
		if p.bad {
			return rejected
		}
		events, chunks = append(events, p.events...), append(chunks, p.chunks...)
	}
	for _, batch := range splitBatches(meta, events, chunks) {
		if res := outcomeOf(u.post(ctx, batch)); res != accepted {
			return res
		}
	}
	return accepted
}

func (u *Uploader) post(ctx context.Context, batch Batch) (int, error) {
	body, err := gzipJSON(batch)
	if err != nil {
		return http.StatusBadRequest, err
	}
	if len(body) > limitGzipBodyBytes {
		return http.StatusRequestEntityTooLarge, nil // the server would say the same
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.Endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("X-Device-Id", batch.DeviceID)
	if u.Token != nil {
		if t := u.Token(); t != "" {
			req.Header.Set("Authorization", "Bearer "+t)
		}
	}
	resp, err := u.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	return resp.StatusCode, nil
}

var (
	reEventType = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`)
	reEventID   = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reErrorCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,47}$`)
)

// clampMeta cuts the device context to the contract limits.
func clampMeta(m Meta) Meta {
	m.AppVersion = truncate(m.AppVersion, limitAppVersion)
	m.CoreVersion = truncate(m.CoreVersion, limitCoreVersion)
	m.OS = truncate(m.OS, limitOS)
	m.Arch = truncate(m.Arch, limitArch)
	m.AccountHint = truncate(m.AccountHint, limitAccountHint)
	return m
}

// clampEvent cuts every bounded field of a spooled event to the contract
// limits (segments written by older versions used larger sizes). strict is
// the second attempt after a 400: an event whose shape the server cannot
// accept is dropped (ok=false) and long text is cut much harder.
func clampEvent(e Event, session string, strict bool) (out Event, ok bool) {
	textLimit := limitErrorText
	if strict {
		textLimit = limitErrorText / 4
	}
	e.ErrorText = truncate(e.ErrorText, textLimit)
	if e.SessionID == "" {
		e.SessionID = session
	}
	e.SessionID = cutPlain(e.SessionID, limitSessionID)
	e.Seq = min(max(e.Seq, 0), limitSeq)
	if e.DurationMs != nil {
		d := min(max(*e.DurationMs, 0), limitDurationMs)
		e.DurationMs = &d
	}
	if e.ErrorCode != "" && !reErrorCode.MatchString(e.ErrorCode) {
		e.ErrorCode = ErrUnknown
	}
	if !strict {
		return e, true
	}
	_, tsErr := time.Parse(time.RFC3339Nano, e.TS)
	shapeOK := reEventID.MatchString(e.EventID) && reEventType.MatchString(e.Type) && utf16Len(e.Type) <= limitEventType &&
		e.SessionID != "" && tsErr == nil && (e.Status == OK || e.Status == Fail || e.Status == Info)
	return e, shapeOK
}

// cutPlain shortens an identifier without a suffix (ids must stay ids).
func cutPlain(s string, max int) string {
	for utf16Len(s) > max {
		r := []rune(s)
		s = string(r[:len(r)-1])
	}
	return s
}

// segmentParts turns one segment into upload parts: its events, and its log
// lines grouped into chunks of about chunkFlushBytes. Chunk ids derive from
// the segment name, so a retried upload is de-duplicated server-side.
func segmentParts(meta Meta, path string, recs []record, strict bool) (events []Event, chunks []LogChunk) {
	name := path[strings.LastIndexAny(path, `/\`)+1:]
	session := cutPlain(segmentSession(path), limitSessionID)
	lineLimit := maxLineLen
	if strict {
		lineLimit = maxLineLen / 4
	}
	var sb strings.Builder
	var first, last int64
	lines := 0
	flush := func() {
		if lines == 0 {
			return
		}
		chunks = append(chunks, LogChunk{
			ChunkID: stableUUID(fmt.Sprintf("%s|%s|%d", meta.DeviceID, name, len(chunks))), SessionID: session,
			StartedAt: time.UnixMilli(first).UTC().Format(time.RFC3339Nano), EndedAt: time.UnixMilli(last).UTC().Format(time.RFC3339Nano),
			LineCount: lines, Text: sb.String(),
		})
		sb.Reset()
		lines = 0
	}
	for _, r := range recs {
		if r.K == "e" {
			if ev, ok := clampEvent(*r.E, session, strict); ok {
				events = append(events, ev)
			}
			continue
		}
		if session == "" {
			continue // a chunk without a session id can never be accepted
		}
		if lines == 0 {
			first = r.T
		}
		last = r.T
		sb.WriteString(time.UnixMilli(r.T).Format("15:04:05.000 "))
		sb.WriteString(truncate(r.S, lineLimit))
		sb.WriteByte('\n')
		lines++
		if sb.Len() >= chunkFlushBytes || lines >= limitChunkLines {
			flush()
		}
	}
	flush()
	return events, chunks
}

func newBatch(meta Meta, events []Event, chunks []LogChunk) Batch {
	b := Batch{SchemaVersion: SchemaVersion, Meta: clampMeta(meta), Events: events, Logs: chunks}
	if b.Events == nil {
		b.Events = []Event{}
	}
	if b.Logs == nil {
		b.Logs = []LogChunk{}
	}
	return b
}

// splitBatches packs parts into as few requests as the per-batch counts
// allow (normally one). Nothing to send = no batch.
func splitBatches(meta Meta, events []Event, chunks []LogChunk) []Batch {
	var out []Batch
	for len(events) > 0 || len(chunks) > 0 {
		ne, nc := min(len(events), limitBatchEvents), min(len(chunks), limitBatchLogs)
		out = append(out, newBatch(meta, events[:ne], chunks[:nc]))
		events, chunks = events[ne:], chunks[nc:]
	}
	return out
}

func gzipJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if err := json.NewEncoder(zw).Encode(v); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// stableUUID derives a v4-shaped UUID from a string (idempotent chunk ids).
func stableUUID(s string) string {
	sum := sha256.Sum256([]byte(s))
	return formatUUID(sum[:16])
}

func formatUUID(b []byte) string {
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
