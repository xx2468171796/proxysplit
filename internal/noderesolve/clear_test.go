package noderesolve

import "testing"

func TestClearEmptiesCache(t *testing.T) {
	r := New(Config{})
	r.mu.Lock()
	r.cache["a.example.com:443"] = cacheEntry{}
	r.mu.Unlock()
	r.Clear()
	r.mu.Lock()
	n := len(r.cache)
	r.mu.Unlock()
	if n != 0 {
		t.Fatalf("cache has %d entries after Clear", n)
	}
}
