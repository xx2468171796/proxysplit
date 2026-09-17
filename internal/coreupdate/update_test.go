package coreupdate

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestUpdateVerifiesDigestBeforeReplacingCore(t *testing.T) {
	exe := make([]byte, minExeBytes+1)
	copy(exe, "MZ")
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	f, err := zw.Create("sing-box-1.14.1-windows-amd64/sing-box.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(exe); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(archive.Bytes())
	for _, valid := range []bool{false, true} {
		t.Run(fmt.Sprint(valid), func(t *testing.T) {
			dir := t.TempDir()
			dst := filepath.Join(dir, "sing-box.exe")
			if err := os.WriteFile(dst, []byte("existing core"), 0o600); err != nil {
				t.Fatal(err)
			}
			digest := hex.EncodeToString(sum[:])
			if !valid {
				digest = strings.Repeat("0", 64)
			}
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				var body []byte
				switch r.URL.String() {
				case releaseURL:
					body = []byte(fmt.Sprintf(`{"tag_name":"v1.14.1","assets":[{"name":"sing-box-1.14.1-windows-amd64.zip","browser_download_url":"https://github.com/core.zip","digest":"sha256:%s"}]}`, digest))
				case "https://github.com/core.zip":
					body = archive.Bytes()
				default:
					t.Fatalf("unexpected request %s", r.URL)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
			})}
			version, err := updateWithClient(dir, client)
			got, readErr := os.ReadFile(dst)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if valid {
				if err != nil || version != "1.14.1" || !bytes.Equal(got, exe) {
					t.Fatalf("update failed: %s %v", version, err)
				}
			} else if err == nil || string(got) != "existing core" {
				t.Fatalf("bad digest modified existing core: %v", err)
			}
		})
	}
}
