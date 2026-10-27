package latency

import (
	"errors"
	"testing"
	"time"
)

func seq(results ...any) func() (time.Duration, error) {
	i := 0
	return func() (time.Duration, error) {
		r := results[i]
		i++
		if err, ok := r.(error); ok {
			return 0, err
		}
		return r.(time.Duration), nil
	}
}

func TestBestOfKeepsMinimum(t *testing.T) {
	if got := bestOf(2, time.Second, seq(300*time.Millisecond, 120*time.Millisecond)); got != 120 {
		t.Fatalf("got %d, want 120", got)
	}
}

func TestBestOfSingleSuccessCounts(t *testing.T) {
	fail := errors.New("x")
	if got := bestOf(2, time.Second, seq(fail, 80*time.Millisecond)); got != 80 {
		t.Fatalf("got %d, want 80", got)
	}
	if got := bestOf(2, time.Second, seq(90*time.Millisecond, fail)); got != 90 {
		t.Fatalf("got %d, want 90", got)
	}
	if got := bestOf(2, time.Second, seq(fail, fail)); got != -1 {
		t.Fatalf("got %d, want -1", got)
	}
}

func TestBestOfStopsAfterTimeout(t *testing.T) {
	calls := 0
	got := bestOf(2, time.Millisecond, func() (time.Duration, error) {
		calls++
		time.Sleep(2 * time.Millisecond)
		return 0, errors.New("timeout")
	})
	if got != -1 || calls != 1 {
		t.Fatalf("got %d after %d calls, want -1 after 1", got, calls)
	}
}
