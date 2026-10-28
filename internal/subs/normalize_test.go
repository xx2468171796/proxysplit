package subs

import (
	"strings"
	"testing"
)

func TestNormalizeURL(t *testing.T) {
	for in, want := range map[string]string{
		"example.com/sub?t=1": "https://example.com/sub?t=1",
		" https://a.b/c ":     "https://a.b/c",
		"http://a.b/c":        "http://a.b/c",
		"powervpn://profile":  "powervpn://profile",
		"//cdn.example.com/x": "https://cdn.example.com/x",
		"":                    "",
	} {
		if got := NormalizeURL(in); got != want {
			t.Errorf("NormalizeURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseBodyHTMLPage(t *testing.T) {
	_, err := ParseBody([]byte("<!doctype html><html><body>login</body></html>"))
	if err == nil || !strings.Contains(err.Error(), "网页") {
		t.Fatalf("an HTML page must get the plain-language error, got %v", err)
	}
}
