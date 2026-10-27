package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config wires the recorder. Endpoint "" or PROXYSPLIT_TELEMETRY=off disables
// everything (dev builds have no API URL).
type Config struct {
	DataDir   string
	Endpoint  string // e.g. https://host/v1/client/telemetry
	Transport http.RoundTripper
	Meta      func() Meta
	Token     func() string
	Interval  time.Duration // upload tick, default 60 s
	CapBytes  int64         // spool cap, default 20 MB
}

type recorder struct {
	spool   *Spool
	up      *Uploader
	session string
	seq     atomic.Int64
	logs    chan record
	kick    chan struct{}
	stop    chan struct{}
	done    chan struct{}
	// ctx is cancelled by Close so an in-flight upload stops; upWG tracks it.
	ctx    context.Context
	cancel context.CancelFunc
	upWG   sync.WaitGroup
	tailMu sync.Mutex
	tail   []string // last lines for crash reports
	watch  logWatch
	// uploading guards the single drain goroutine (Uploader is not concurrent).
	uploading atomic.Bool
}

var active atomic.Pointer[recorder]

// Disabled reports whether the hidden kill switch is set.
func Disabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYSPLIT_TELEMETRY")))
	return v == "off" || v == "0" || v == "false"
}

// Init starts the recorder; safe to call once. Errors leave telemetry off.
func Init(cfg Config) error {
	if cfg.Endpoint == "" || Disabled() || active.Load() != nil {
		return nil
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 60 * time.Second
	}
	if cfg.CapBytes <= 0 {
		cfg.CapBytes = 20 << 20
	}
	session := NewUUID()
	sp, err := OpenSpool(filepath.Join(cfg.DataDir, "telemetry"), session, 256<<10, cfg.CapBytes)
	if err != nil {
		return err
	}
	tr := cfg.Transport
	if tr == nil {
		tr = http.DefaultTransport
	}
	r := &recorder{
		spool: sp, session: session,
		up:   &Uploader{Endpoint: cfg.Endpoint, Client: &http.Client{Transport: tr, Timeout: 20 * time.Second}, Meta: cfg.Meta, Token: cfg.Token, MinWait: 30 * time.Second, MaxWait: 30 * time.Minute},
		logs: make(chan record, 4096), kick: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}),
	}
	r.ctx, r.cancel = context.WithCancel(context.Background())
	active.Store(r)
	go r.loop(cfg.Interval)
	return nil
}

// Session returns the id of this launch ("" when off).
func Session() string {
	if r := active.Load(); r != nil {
		return r.session
	}
	return ""
}

// Log tees one log line (app or core) into the spool. Never blocks: lines
// are dropped if the writer falls far behind.
func Log(line string) {
	r := active.Load()
	if r == nil {
		return
	}
	select {
	case r.logs <- record{K: "l", T: time.Now().UnixMilli(), S: line}:
	default:
	}
}

// Emit records one event. err != nil makes it a failure with a normalised
// code; payload is sanitised.
func Emit(typ string, status Status, err error, payload map[string]any) {
	emit(typ, status, nil, err, payload)
}

// Op records a timed operation: ok, or fail with err.
func Op(typ string, start time.Time, err error, payload map[string]any) {
	d := time.Since(start).Milliseconds()
	st := OK
	if err != nil {
		st = Fail
	}
	emit(typ, st, &d, err, payload)
}

// Note records an informational event.
func Note(typ string, payload map[string]any) { emit(typ, Info, nil, nil, payload) }

// FailText records a failure given as user-facing text ("" = success).
func FailText(typ string, start time.Time, msg string, payload map[string]any) {
	var err error
	if msg != "" {
		err = textErr(msg)
	}
	Op(typ, start, err, payload)
}

type textErr string

func (e textErr) Error() string { return string(e) }

// Errorf is a tiny helper for call sites that only have text.
func Errorf(format string, a ...any) error { return textErr(fmt.Sprintf(format, a...)) }

func emit(typ string, st Status, dur *int64, err error, payload map[string]any) {
	r := active.Load()
	if r == nil {
		return
	}
	ev := Event{EventID: NewUUID(), SessionID: r.session, Seq: r.seq.Add(1), TS: time.Now().UTC().Format(time.RFC3339Nano), Type: typ, Status: st, DurationMs: dur, Payload: SanitizeMap(payload)}
	if err != nil {
		ev.Status = Fail
		raw := err.Error()
		ev.ErrorCode, ev.ErrorText = Classify(typ, raw), Sanitize(raw)
	} else if st == Fail {
		ev.ErrorCode = typeDefault(typ)
	}
	_ = r.spool.Append(record{K: "e", E: &ev})
	if ev.Status == Fail {
		_ = r.spool.Flush()
		Kick()
	}
}

// Kick asks for an upload now (backoff still applies).
func Kick() {
	if r := active.Load(); r != nil {
		select {
		case r.kick <- struct{}{}:
		default:
		}
	}
}

// Recover is deferred at goroutine tops: records a panic with the last log
// lines, flushes, then re-panics so behaviour is unchanged.
func Recover() {
	if v := recover(); v != nil {
		if r := active.Load(); r != nil {
			r.tailMu.Lock()
			tail := append([]string(nil), r.tail...)
			r.tailMu.Unlock()
			emit(AppCrash, Fail, nil, Errorf("panic: %v", v), map[string]any{"stack": string(debug.Stack()), "lastLines": tail})
			_ = r.spool.Flush()
		}
		panic(v)
	}
}

// Close flushes and stops (on app exit); pending segments upload next launch.
func Close() {
	r := active.Swap(nil)
	if r == nil {
		return
	}
	close(r.stop)
	r.cancel()
	deadline := time.After(2 * time.Second)
	select {
	case <-r.done:
	case <-deadline:
	}
	uploaded := make(chan struct{})
	go func() { r.upWG.Wait(); close(uploaded) }()
	select {
	case <-uploaded:
	case <-deadline:
	}
	r.spool.Close()
}

func (r *recorder) loop(interval time.Duration) {
	defer close(r.done)
	tick := time.NewTicker(interval)
	defer tick.Stop()
	flush := time.NewTicker(time.Second)
	defer flush.Stop()
	upload := func() {
		_ = r.spool.Seal()
		if r.uploading.CompareAndSwap(false, true) {
			r.upWG.Add(1)
			go func() {
				defer r.upWG.Done()
				defer r.uploading.Store(false)
				r.up.Drain(r.ctx, r.spool.Segments(), 20)
			}()
		}
	}
	for {
		select {
		case rec := <-r.logs:
			r.writeLog(rec)
		case <-flush.C:
			_ = r.spool.Flush()
		case <-tick.C:
			upload()
		case <-r.kick:
			upload()
		case <-r.stop:
			for {
				select {
				case rec := <-r.logs:
					r.writeLog(rec)
				default:
					_ = r.spool.Flush()
					return
				}
			}
		}
	}
}

func (r *recorder) writeLog(rec record) {
	rec.S = Sanitize(rec.S)
	r.tailMu.Lock()
	r.tail = append(r.tail, rec.S)
	if len(r.tail) > 40 {
		r.tail = r.tail[len(r.tail)-40:]
	}
	r.tailMu.Unlock()
	_ = r.spool.Append(rec)
	if typ, st, text := r.watch.inspect(rec.S); typ != "" {
		var err error
		if text != "" {
			err = textErr(text)
		}
		go emit(typ, st, nil, err, nil) // own goroutine: emit may Kick back into this loop
	}
}

// NewUUID returns a random v4 UUID.
func NewUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return formatUUID(b)
}
