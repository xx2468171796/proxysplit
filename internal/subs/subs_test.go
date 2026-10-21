package subs

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsMetadataNode(t *testing.T) {
	for _, name := range []string{
		"剩余流量：261.61 GB",
		"套餐到期：长期有效",
		"过滤掉15条线路",
		"Traffic: 100 GB",
	} {
		if !isMetadataNode(name) {
			t.Fatalf("expected metadata node: %q", name)
		}
	}
	for _, name := range []string{"日本-优化", "香港 WAP", "US Traffic Relay"} {
		if isMetadataNode(name) {
			t.Fatalf("unexpected metadata node: %q", name)
		}
	}
}

func TestFetchClashYAMLAndUserAgent(t *testing.T) {
	var userAgent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userAgent = r.UserAgent()
		_, _ = w.Write([]byte(`
proxies:
  - name: test
    type: vmess
    server: edge.example.com
    port: 443
    uuid: eb936878-a3dd-4a79-a9d7-9337ae519bef
    cipher: auto
`))
	}))
	defer server.Close()
	res, err := FetchWith(server.URL, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if userAgent != "Clash.Meta" {
		t.Fatalf("User-Agent=%q", userAgent)
	}
	if got := res.Nodes; len(got) != 1 || got[0].Type != "vmess" {
		t.Fatalf("unexpected nodes: %+v", got)
	}
}
