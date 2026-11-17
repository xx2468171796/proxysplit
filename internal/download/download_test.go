package download

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func payload(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i * 7)
	}
	return b
}

func request(srv *httptest.Server, path string) Request {
	return Request{Client: srv.Client(), URL: srv.URL, Path: path, Window: 200 * time.Millisecond}
}

// A partial file is continued with Range, not started over.
func TestResumeContinuesPartialFile(t *testing.T) {
	data := payload(200_000)
	var ranges []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		http.ServeContent(w, r, "f", time.Time{}, bytes.NewReader(data))
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "f.download")
	if err := os.WriteFile(path, data[:70_000], 0o600); err != nil {
		t.Fatal(err)
	}
	from, err := Resume(context.Background(), request(srv, path))
	if err != nil || from != 70_000 {
		t.Fatalf("from=%d err=%v", from, err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, data) {
		t.Fatal("resumed file differs from the original")
	}
	if len(ranges) != 1 || ranges[0] != "bytes=70000-" {
		t.Fatalf("ranges asked: %v", ranges)
	}
}

// A server without Range support answers 200: the file starts over.
func TestResumeRestartsWhenServerIgnoresRange(t *testing.T) {
	data := payload(50_000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(data) }))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "f.download")
	_ = os.WriteFile(path, []byte("stale partial content"), 0o600)
	from, err := Resume(context.Background(), request(srv, path))
	if err != nil || from != 0 {
		t.Fatalf("from=%d err=%v", from, err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, data) {
		t.Fatal("file must hold exactly the fresh body")
	}
}

// A transfer that stops moving is aborted by the watchdog and keeps what it
// has; the next attempt continues from there.
func TestResumeStallKeepsPartial(t *testing.T) {
	data := payload(120_000)
	stalled := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !stalled {
			http.ServeContent(w, r, "f", time.Time{}, bytes.NewReader(data))
			return
		}
		w.Header().Set("Content-Length", "120000")
		_, _ = w.Write(data[:40_000])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "f.download")
	_, err := Resume(context.Background(), request(srv, path))
	if !errors.Is(err, ErrTooSlow) {
		t.Fatalf("want a watchdog abort, got %v", err)
	}
	if st, _ := os.Stat(path); st == nil || st.Size() != 40_000 {
		t.Fatalf("the partial file must be kept for the next attempt: %v", st)
	}
	stalled = false
	if from, err := Resume(context.Background(), request(srv, path)); err != nil || from != 40_000 {
		t.Fatalf("second attempt: from=%d err=%v", from, err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, data) {
		t.Fatal("file after stall + resume differs")
	}
}

// Slow is not stalled: with MinBPS 0 a trickle that keeps moving for several
// watchdog windows finishes; the same trickle fails a speed floor.
func TestResumeSlowButMovingFinishes(t *testing.T) {
	data := payload(60)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "60")
		for i := 0; i < len(data); i += 10 {
			_, _ = w.Write(data[i : i+10])
			w.(http.Flusher).Flush()
			time.Sleep(120 * time.Millisecond)
		}
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "f.download")
	if _, err := Resume(context.Background(), request(srv, path)); err != nil {
		t.Fatalf("a moving transfer must not be aborted: %v", err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, data) {
		t.Fatal("content differs")
	}
	floor := request(srv, filepath.Join(t.TempDir(), "g.download"))
	floor.MinBPS = 30000
	if _, err := Resume(context.Background(), floor); !errors.Is(err, ErrTooSlow) {
		t.Fatalf("a speed floor must abort the trickle, got %v", err)
	}
}

func TestResumeEnforcesMaxBytes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload(5000)) }))
	defer srv.Close()
	req := request(srv, filepath.Join(t.TempDir(), "f.download"))
	req.MaxBytes = 1000
	if _, err := Resume(context.Background(), req); err == nil {
		t.Fatal("a body over MaxBytes must fail")
	}
}

// A range that does not continue where the file ends cannot be appended.
func TestResumeRejectsWrongRange(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Range", "bytes 5-9/10")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("56789"))
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "f.download")
	_ = os.WriteFile(path, []byte("012"), 0o600)
	if _, err := Resume(context.Background(), request(srv, path)); err == nil {
		t.Fatal("a mismatching Content-Range must fail")
	}
	if st, _ := os.Stat(path); st.Size() != 0 {
		t.Fatal("an unusable partial file must be emptied")
	}
}
