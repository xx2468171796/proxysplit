// Package nodereport uploads each device's full node and subscription list
// (incl. share links) to POST /v1/client/nodes — internal, owner decision
// 2026-10-28, contract in docs/节点上报.md. Never mentioned in user-visible
// text. A snapshot is sent at start, whenever its fingerprint changes, and as
// a keep-alive every 6 hours.
package nodereport

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Node is one node as reported (docs/节点上报.md §1).
type Node struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Server     string  `json:"server"`
	Port       int     `json:"port"`
	Network    string  `json:"network,omitempty"`
	Security   string  `json:"security,omitempty"`
	SNI        string  `json:"sni,omitempty"`
	Core       string  `json:"core"`
	Via        string  `json:"via,omitempty"`
	SubID      string  `json:"subId,omitempty"`
	Official   bool    `json:"official"`
	Source     string  `json:"source"` // manual | sub | official
	Latency    int     `json:"latency"`
	TCPLatency int     `json:"tcpLatency"`
	Speed      float64 `json:"speed"`
	Link       string  `json:"link"`
}

// Sub is one subscription as reported.
type Sub struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Host       string `json:"host"`
	NodeCount  int    `json:"nodeCount"`
	AutoUpdate bool   `json:"autoUpdate"`
	LastUpdate string `json:"lastUpdate,omitempty"`
}

// Inventory is what the service hands over.
type Inventory struct {
	SelectedID string
	Nodes      []Node
	Subs       []Sub
}

// Body is the upload (before gzip).
type Body struct {
	SchemaVersion int    `json:"schemaVersion"`
	DeviceID      string `json:"deviceId"`
	AppVersion    string `json:"appVersion"`
	AccountHint   string `json:"accountHint,omitempty"`
	Reason        string `json:"reason"`
	SelectedID    string `json:"selectedId"`
	Nodes         []Node `json:"nodes"`
	Subs          []Sub  `json:"subs"`
}

// Reporter sends snapshots from a single goroutine (Run).
type Reporter struct {
	Endpoint    string
	Client      *http.Client
	DeviceID    func() string
	AccountHint func() string
	Token       func() string
	AppVersion  string
	Source      func() Inventory

	FirstDelay time.Duration // default 20 s
	Tick       time.Duration // default 30 s
	KeepAlive  time.Duration // default 6 h
	// MeasureEvery: test results alone are uploaded at most this often (10 min).
	MeasureEvery time.Duration

	lastFP   string
	lastMeas string
	lastSent time.Time
	fails    int
	nextTry  time.Time
}

func (r *Reporter) defaults() {
	if r.FirstDelay <= 0 {
		r.FirstDelay = 20 * time.Second
	}
	if r.Tick <= 0 {
		r.Tick = 30 * time.Second
	}
	if r.KeepAlive <= 0 {
		r.KeepAlive = 6 * time.Hour
	}
	if r.MeasureEvery <= 0 {
		r.MeasureEvery = 10 * time.Minute
	}
}

// Run blocks until ctx ends.
func (r *Reporter) Run(ctx context.Context) {
	r.defaults()
	t := time.NewTimer(r.FirstDelay)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		r.Step(ctx, time.Now())
		t.Reset(r.Tick)
	}
}

// Fingerprint of the inventory without the test results (latency / speed
// change with every test run; they ride along with the next real change, or
// go up on their own at most every MeasureEvery).
func Fingerprint(inv Inventory) string {
	c := inv
	c.Nodes = make([]Node, len(inv.Nodes))
	for i, n := range inv.Nodes {
		n.Latency, n.TCPLatency, n.Speed = 0, 0, 0
		c.Nodes[i] = n
	}
	return hashJSON(c)
}

func hashJSON(v any) string {
	b, _ := json.Marshal(v)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

// Step uploads a snapshot when it is the first, changed, or the keep-alive is
// due; it reports whether an upload was attempted. Failures back off from 30 s
// to 30 min.
func (r *Reporter) Step(ctx context.Context, now time.Time) bool {
	r.defaults()
	if now.Before(r.nextTry) {
		return false
	}
	inv := r.Source()
	fp, meas := Fingerprint(inv), hashJSON(inv)
	var reason string
	switch {
	case r.lastSent.IsZero():
		reason = "start"
	case fp != r.lastFP:
		reason = "change"
	case now.Sub(r.lastSent) >= r.KeepAlive,
		meas != r.lastMeas && now.Sub(r.lastSent) >= r.MeasureEvery:
		reason = "periodic"
	default:
		return false
	}
	if err := r.send(ctx, inv, reason); err != nil {
		r.fails++
		wait := (30 * time.Second) * time.Duration(1<<min(r.fails-1, 6))
		r.nextTry = now.Add(min(wait, 30*time.Minute))
		return true
	}
	r.fails, r.nextTry = 0, time.Time{}
	r.lastFP, r.lastMeas, r.lastSent = fp, meas, now
	return true
}

func (r *Reporter) send(ctx context.Context, inv Inventory, reason string) error {
	body := Body{SchemaVersion: 1, DeviceID: r.DeviceID(), AppVersion: r.AppVersion, Reason: reason,
		SelectedID: inv.SelectedID, Nodes: inv.Nodes, Subs: inv.Subs}
	if body.DeviceID == "" {
		return fmt.Errorf("no device id")
	}
	if body.Nodes == nil {
		body.Nodes = []Node{}
	}
	if body.Subs == nil {
		body.Subs = []Sub{}
	}
	if r.AccountHint != nil {
		body.AccountHint = r.AccountHint()
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if err := json.NewEncoder(zw).Encode(body); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.Endpoint, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("X-Device-Id", body.DeviceID)
	if r.Token != nil {
		if t := r.Token(); t != "" {
			req.Header.Set("Authorization", "Bearer "+t)
		}
	}
	resp, err := r.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("upload: HTTP %d", resp.StatusCode)
	}
	return nil
}
