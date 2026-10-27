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
	"strings"
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

// Uploader sends sealed spool segments, oldest first, one segment per request.
type Uploader struct {
	Endpoint string
	Client   *http.Client
	Meta     func() Meta
	Token    func() string // bearer access token, "" when signed out
	MinWait  time.Duration // first backoff step
	MaxWait  time.Duration // backoff ceiling

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
func (u *Uploader) Ready() bool { return !u.clock().Before(u.nextAfter) }

// backoff schedules the next attempt: MinWait·2^n with ±20 % jitter, capped.
func (u *Uploader) backoff() {
	u.failures++
	wait := u.MinWait << min(u.failures-1, 16)
	if wait > u.MaxWait || wait <= 0 {
		wait = u.MaxWait
	}
	jitter := time.Duration(float64(wait) * (0.8 + 0.4*rand.Float64()))
	u.nextAfter = u.clock().Add(jitter)
}

// Drain uploads up to max segments. It stops at the first failure and backs
// off; a segment the server rejects as malformed / too large is dropped so it
// can never block the queue.
func (u *Uploader) Drain(ctx context.Context, segments []string, max int) (sent int) {
	for i, path := range segments {
		if i >= max || !u.Ready() {
			return sent
		}
		status, err := u.sendSegment(ctx, path)
		switch {
		case err == nil && status/100 == 2, status == http.StatusRequestEntityTooLarge, status == http.StatusBadRequest:
			_ = os.Remove(path)
			if status/100 == 2 {
				sent++
				u.failures, u.nextAfter = 0, time.Time{}
			}
		default:
			u.backoff()
			return sent
		}
	}
	return sent
}

func (u *Uploader) sendSegment(ctx context.Context, path string) (int, error) {
	recs, err := readSegment(path)
	if err != nil {
		return 0, err
	}
	batch := buildBatch(u.Meta(), path, recs)
	if len(batch.Events) == 0 && len(batch.Logs) == 0 {
		return http.StatusOK, nil
	}
	body, err := gzipJSON(batch)
	if err != nil {
		return http.StatusBadRequest, err
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

// buildBatch turns one segment into an upload: events as-is, log lines
// grouped into chunks of at most ~256 KB with ids derived from the segment
// name, so a retried upload is de-duplicated server-side.
func buildBatch(meta Meta, path string, recs []record) Batch {
	b := Batch{SchemaVersion: SchemaVersion, Meta: meta, Events: []Event{}, Logs: []LogChunk{}}
	session := segmentSession(path)
	var sb strings.Builder
	var first, last int64
	lines := 0
	flush := func() {
		if lines == 0 {
			return
		}
		b.Logs = append(b.Logs, LogChunk{
			ChunkID: stableUUID(fmt.Sprintf("%s|%s|%d", meta.DeviceID, path[strings.LastIndexAny(path, `/\`)+1:], len(b.Logs))), SessionID: session,
			StartedAt: time.UnixMilli(first).UTC().Format(time.RFC3339Nano), EndedAt: time.UnixMilli(last).UTC().Format(time.RFC3339Nano),
			LineCount: lines, Text: sb.String(),
		})
		sb.Reset()
		lines = 0
	}
	for _, r := range recs {
		if r.K == "e" {
			b.Events = append(b.Events, *r.E)
			continue
		}
		if lines == 0 {
			first = r.T
		}
		last = r.T
		sb.WriteString(time.UnixMilli(r.T).Format("15:04:05.000 "))
		sb.WriteString(r.S)
		sb.WriteByte('\n')
		lines++
		if sb.Len() >= 256<<10 {
			flush()
		}
	}
	flush()
	return b
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
