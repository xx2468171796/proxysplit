package geoupdate

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeFiles are three small valid rule-sets keyed by name.
func fakeFiles(tag string) map[string][]byte {
	out := map[string][]byte{}
	for _, rs := range ruleSets {
		out[rs.name] = []byte("SRS" + tag + rs.name)
	}
	return out
}

// mirror serves manifest.json + files; corrupt names are served with wrong
// content (manifest still lists the good checksum). Counts file downloads.
func mirror(t *testing.T, files map[string][]byte, corrupt map[string]bool, hits *int32) {
	t.Helper()
	var list []manifestFile
	for name, b := range files {
		list = append(list, manifestFile{Name: name, SHA256: sum(b), Size: len(b)})
	}
	manifest, _ := json.Marshal(map[string]any{"files": list})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/rules/")
		if name == "manifest.json" {
			w.Write(manifest)
			return
		}
		b, ok := files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(hits, 1)
		if corrupt[name] {
			b = []byte("SRS-tampered")
		}
		w.Write(b)
	}))
	t.Cleanup(srv.Close)
	old := MirrorBase
	MirrorBase = srv.URL + "/rules/"
	t.Cleanup(func() { MirrorBase = old })
}

// upstream points the fallback URLs at a local server serving files.
func upstream(t *testing.T, files map[string][]byte) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := files[strings.TrimPrefix(r.URL.Path, "/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(b)
	}))
	t.Cleanup(srv.Close)
	old := ruleSets
	ruleSets = nil
	for _, rs := range old {
		ruleSets = append(ruleSets, ruleSet{rs.name, srv.URL + "/" + rs.name})
	}
	t.Cleanup(func() { ruleSets = old })
}

func readAll(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, rs := range ruleSets {
		b, _ := os.ReadFile(filepath.Join(dir, rs.name))
		out[rs.name] = string(b)
	}
	return out
}

func TestSyncDownloadsThenSkipsCurrentFiles(t *testing.T) {
	files := fakeFiles("v1")
	var hits int32
	mirror(t, files, nil, &hits)
	dir := t.TempDir()

	res, err := Sync(dir)
	if err != nil || res.Changed != 3 || res.Current != 3 {
		t.Fatalf("first sync: %+v %v", res, err)
	}
	for name, got := range readAll(t, dir) {
		if got != string(files[name]) {
			t.Fatalf("%s = %q", name, got)
		}
	}

	res, err = Sync(dir)
	if err != nil || res.Changed != 0 || res.Current != 3 {
		t.Fatalf("second sync: %+v %v", res, err)
	}
	if hits != 3 {
		t.Fatalf("downloaded %d files, want 3 (unchanged files must not be fetched again)", hits)
	}
}

func TestSyncRejectsChecksumMismatchAndKeepsOldFile(t *testing.T) {
	dir := t.TempDir()
	name := "geosite-cn.srs"
	if err := os.WriteFile(filepath.Join(dir, name), []byte("SRSold"), 0o644); err != nil {
		t.Fatal(err)
	}
	var hits int32
	mirror(t, fakeFiles("v2"), map[string]bool{name: true}, &hits)

	res, err := Sync(dir)
	if err == nil || !strings.Contains(err.Error(), name) {
		t.Fatalf("want error naming %s, got %v", name, err)
	}
	if res.Current != 2 {
		t.Fatalf("other files should still update: %+v", res)
	}
	if got := readAll(t, dir)[name]; got != "SRSold" {
		t.Fatalf("tampered download replaced the file: %q", got)
	}
}

func TestUpdateFallsBackToUpstreamWhenMirrorDown(t *testing.T) {
	old := MirrorBase
	MirrorBase = "http://127.0.0.1:1/rules/" // nothing listens here
	t.Cleanup(func() { MirrorBase = old })
	files := fakeFiles("up")
	upstream(t, files)
	dir := t.TempDir()

	if _, err := Sync(dir); err == nil {
		t.Fatal("Sync must not fall back to upstream")
	}
	res, err := Update(dir, "")
	if err != nil || res.Upstream != 3 || res.Current != 3 {
		t.Fatalf("update: %+v %v", res, err)
	}
	for name, got := range readAll(t, dir) {
		if got != string(files[name]) {
			t.Fatalf("%s = %q", name, got)
		}
	}
}

func TestUpdateRejectsNonSRSUpstream(t *testing.T) {
	old := MirrorBase
	MirrorBase = "http://127.0.0.1:1/rules/"
	t.Cleanup(func() { MirrorBase = old })
	bad := map[string][]byte{}
	for _, rs := range ruleSets {
		bad[rs.name] = []byte("<html>blocked</html>")
	}
	upstream(t, bad)
	dir := t.TempDir()
	if _, err := Update(dir, ""); err == nil {
		t.Fatal("want error for non-SRS bodies")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("nothing should be written, got %d entries", len(entries))
	}
}

// TestLiveMirror checks the real Shenzhen mirror end to end. Skips offline.
func TestLiveMirror(t *testing.T) {
	if testing.Short() {
		t.Skip("network")
	}
	dir := t.TempDir()
	res, err := Sync(dir)
	if err != nil {
		t.Skipf("mirror unreachable: %v", err)
	}
	if res.Changed != 3 {
		t.Fatalf("live mirror: %+v", res)
	}
}
