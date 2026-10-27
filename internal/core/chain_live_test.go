package core

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

// TestChainLive dials a real node through a real front node (manual, needs
// network): PROXYSPLIT_CHAIN_IT=1, PROXYSPLIT_CHAIN_TARGET=<share link or
// host:port:user:pass>, PROXYSPLIT_CHAIN_FRONT=<node name in the local
// ProxySplit config>. Credentials only ever come from the environment.
func TestChainLive(t *testing.T) {
	if os.Getenv("PROXYSPLIT_CHAIN_IT") != "1" {
		t.Skip("manual integration test")
	}
	list, _ := nodes.ParseMany(os.Getenv("PROXYSPLIT_CHAIN_TARGET"))
	if len(list) == 0 {
		t.Fatal("target not parsed")
	}
	target := list[0]
	raw, err := os.ReadFile(filepath.Join(os.Getenv("APPDATA"), "proxysplit", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Nodes []*nodes.Node `json:"nodes"`
	}
	_ = json.Unmarshal(raw, &cfg)
	for _, n := range cfg.Nodes {
		if n.Name == os.Getenv("PROXYSPLIT_CHAIN_FRONT") {
			target.ViaNode = n
		}
	}
	if target.ViaNode == nil {
		t.Fatal("front node not found")
	}
	for _, chained := range []bool{false, true} {
		n := *target
		if !chained {
			n.ViaNode = nil
		}
		pr, err := StartProbe(singboxPath(t), t.TempDir(), &n, 6*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		proxy, _ := url.Parse("http://" + pr.Addr())
		c := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}}
		start := time.Now()
		resp, err := c.Get("https://www.gstatic.com/generate_204")
		status := 0
		if err == nil {
			status = resp.StatusCode
			resp.Body.Close()
		}
		t.Logf("chained=%v status=%d err=%v took=%s", chained, status, err, time.Since(start).Round(time.Millisecond))
		_ = pr.Close()
	}
}
