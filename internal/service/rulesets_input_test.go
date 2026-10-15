package service

import (
	"strings"
	"testing"

	"proxysplit/internal/core"
)

// TestNormalizeRouteRulesInput: what people type becomes a working rule, and
// the remaining mistakes are rejected with a hint.
func TestNormalizeRouteRulesInput(t *testing.T) {
	for _, c := range []struct {
		typ, in, wantTyp, want string
	}{
		{"suffix", "zygskins.cn", "suffix", "zygskins.cn"},
		{"suffix", "https://www.ZygSkins.cn/login?a=1", "suffix", "www.zygskins.cn"},
		{"domain", "http://user@www.github.com:8443/x", "domain", "www.github.com"},
		{"domain", "*.zygskins.cn", "suffix", "zygskins.cn"},
		{"domain", ".github.com", "suffix", "github.com"},
		{"suffix", "github.com.", "suffix", "github.com"},
		{"suffix", "github。com", "suffix", "github.com"},
		{"suffix", "1.1.1.1", "ip", "1.1.1.1"},
		{"domain", "10.0.0.0/8", "ip", "10.0.0.0/8"},
		{"suffix", "https://[2001:db8::1]:443/", "ip", "2001:db8::1"},
		{"keyword", "  ZygSkins ", "keyword", "zygskins"},
		{"ip", "10.1.2.3/8", "ip", "10.0.0.0/8"},
	} {
		got, err := normalizeRouteRules([]core.RouteRule{{Type: c.typ, Value: c.in, Action: "proxy"}})
		if err != nil {
			t.Errorf("%s %q: %v", c.typ, c.in, err)
			continue
		}
		if len(got) != 1 || got[0].Type != c.wantTyp || got[0].Value != c.want {
			t.Errorf("%s %q: got %+v, want %s %s", c.typ, c.in, got, c.wantTyp, c.want)
		}
	}
	for _, c := range []struct{ typ, in, hint string }{
		{"suffix", "*zygskins*", "关键字"},
		{"domain", "www.*.com", "开头"},
		{"ip", "github.com", "域名后缀"},
	} {
		_, err := normalizeRouteRules([]core.RouteRule{{Type: c.typ, Value: c.in, Action: "proxy"}})
		if err == nil || !strings.Contains(err.Error(), c.hint) {
			t.Errorf("%s %q: want error mentioning %q, got %v", c.typ, c.in, c.hint, err)
		}
	}
}
