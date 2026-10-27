package nodes

import "testing"

// Scheme-less proxies from residential-proxy sellers import as socks5.
func TestBareSocksForms(t *testing.T) {
	cases := []struct{ in, server, user, pass string }{
		{"198.87.105.21:8022:zqrdwscddd:oqwmwemoptmio", "198.87.105.21", "zqrdwscddd", "oqwmwemoptmio"},
		{"zqrdwscddd:oqwmwemoptmio:198.87.105.21:8022", "198.87.105.21", "zqrdwscddd", "oqwmwemoptmio"},
		{"zqrdwscddd:oqwmwemoptmio@198.87.105.21:8022", "198.87.105.21", "zqrdwscddd", "oqwmwemoptmio"},
		{"proxy.example.com:1080:u:p:with:colons", "proxy.example.com", "u", "p:with:colons"},
		{"198.87.105.21:8022", "198.87.105.21", "", ""},
	}
	for _, c := range cases {
		n, err := ParseLink(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if n.Type != "socks" || n.Server != c.server || n.Port == 0 || n.Username != c.user || n.Password != c.pass {
			t.Fatalf("%s -> %+v", c.in, n)
		}
	}
	for _, bad := range []string{"hello", "a:b", "1.2.3.4:99999:u:p", "user:pass:host:80", "https://example.com/sub"} {
		if n, err := ParseLink(bad); err == nil && n.Type == "socks" {
			t.Fatalf("%q must not parse as socks: %+v", bad, n)
		}
	}
	got, skipped := ParseMany("198.87.105.21:8022:a:b\n1.2.3.4:1080:c:d\nnot a node")
	if len(got) != 2 || skipped != 1 {
		t.Fatalf("ParseMany = %d nodes, %d skipped", len(got), skipped)
	}
}
