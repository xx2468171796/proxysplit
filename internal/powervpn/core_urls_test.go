package powervpn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The signature covers the raw response body, so the added `urls` field is
// verified like every other field: new panels with urls and old panels
// without it both pass; a body tampered after signing does not.
func TestCoreMirrorURLs(t *testing.T) {
	s := newSigner(t)
	sha := strings.Repeat("b", 64)
	bodies := map[string]string{
		"new": `{"version":"1.14.2","build":"relayops.6","sha256":"` + sha + `","url":"/api/client/core/download/sb.exe",` +
			`"urls":["https://powerdl.example/pub/relayops/core/` + sha + `/sb.exe","/rel/sb.exe","ftp://x/sb.exe","file:///c/x","","http://tw.example:18790/pub/relayops/core/x/sb.exe","/api/client/core/download/sb.exe"]}`,
		"old":      `{"version":"1.14.2","build":"relayops.6","sha256":"` + sha + `","url":"/api/client/core/download/sb.exe"}`,
		"future":   `{"version":"1.14.2","build":"relayops.6","sha256":"` + sha + `","url":"/api/client/core/download/sb.exe","urls":null,"extra":{"urls":[1]}}`,
		"tampered": ``,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/core", func(w http.ResponseWriter, r *http.Request) {
		kind := r.URL.Query().Get("os")
		if kind == "tampered" {
			// sign one body, deliver another with an extra mirror
			signed := []byte(bodies["old"])
			rec := httptest.NewRecorder()
			s.write(rec, SigTypeCore, signed)
			for k, v := range rec.Header() {
				w.Header()[k] = v
			}
			_, _ = w.Write([]byte(strings.Replace(bodies["old"], `"url"`, `"urls":["https://evil.example/x"],"url"`, 1)))
			return
		}
		s.write(w, SigTypeCore, []byte(bodies[kind]))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	ctx := context.Background()

	ci, err := c.Core(ctx, "new", "amd64")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"https://powerdl.example/pub/relayops/core/" + sha + "/sb.exe",
		srv.URL + "/rel/sb.exe",
		"http://tw.example:18790/pub/relayops/core/x/sb.exe",
		srv.URL + "/api/client/core/download/sb.exe",
	}
	if strings.Join(ci.URLs, "\n") != strings.Join(want, "\n") {
		t.Fatalf("urls = %v, want %v", ci.URLs, want)
	}
	if ci.URL != srv.URL+"/api/client/core/download/sb.exe" {
		t.Fatalf("origin url changed: %s", ci.URL)
	}

	for _, k := range []string{"old", "future"} {
		ci, err := c.Core(ctx, k, "amd64")
		if err != nil || len(ci.URLs) != 0 || ci.URL == "" {
			t.Fatalf("%s: %+v %v", k, ci, err)
		}
	}
	if _, err := c.Core(ctx, "tampered", "amd64"); err == nil {
		t.Fatal("body tampered after signing (extra urls) was accepted")
	}
}
