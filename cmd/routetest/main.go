// Command routetest verifies bypass_cn routing: through the core's SOCKS it hits a
// China domain and a foreign domain, then checks sing-box's log to confirm the
// China one took the direct outbound and the foreign one took the node.
// Usage: routetest "<share-link>"
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: routetest \"<link>\"")
		os.Exit(2)
	}
	node, err := nodes.ParseLink(os.Args[1])
	if err != nil {
		fmt.Println("parse:", err)
		os.Exit(1)
	}

	var mu sync.Mutex
	var logs []string
	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-routetest")
	os.RemoveAll(dataDir)
	mgr := core.NewManager(filepath.Join(binDir, "sing-box.exe"), dataDir, func(l string) {
		mu.Lock()
		logs = append(logs, l)
		mu.Unlock()
	})
	port, err := mgr.Start(node, 0, "info", core.Options{RemoteDNS: true, RouteMode: core.RouteBypassCN, GeoDir: binDir})
	if err != nil {
		fmt.Println("core start:", err)
		os.Exit(1)
	}
	defer mgr.Stop()

	d, _ := proxy.SOCKS5("tcp", fmt.Sprintf("127.0.0.1:%d", port), nil, proxy.Direct)
	client := &http.Client{
		Timeout:   12 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, n, a string) (net.Conn, error) { return d.Dial(n, a) }},
	}
	get := func(url string) { r, e := client.Get(url); if e == nil { r.Body.Close() } }

	get("https://www.baidu.com")     // China -> expect direct
	get("https://api.ipify.org")     // foreign -> expect proxy
	time.Sleep(600 * time.Millisecond)

	mu.Lock()
	joined := strings.Join(logs, "\n")
	mu.Unlock()

	baiduDirect := outboundFor(joined, "baidu", "direct")
	baiduProxy := outboundFor(joined, "baidu", "vless")
	ipifyProxy := outboundFor(joined, "ipify", "vless")
	ipifyDirect := outboundFor(joined, "ipify", "direct")

	fmt.Printf("baidu.com   -> direct:%v proxy:%v\n", baiduDirect, baiduProxy)
	fmt.Printf("api.ipify   -> direct:%v proxy:%v\n", ipifyDirect, ipifyProxy)
	fmt.Println("---- RESULT ----")
	if baiduDirect && ipifyProxy {
		fmt.Println("PASS: bypass_cn works — China domain went DIRECT, foreign domain went through the NODE.")
	} else {
		fmt.Println("FAIL: routing did not split as expected.")
		fmt.Println("---- outbound log lines ----")
		for _, l := range logs {
			if strings.Contains(l, "outbound") && (strings.Contains(l, "baidu") || strings.Contains(l, "ipify")) {
				fmt.Println("  ", l)
			}
		}
	}
}

// outboundFor reports whether the log shows host handled by an outbound of kind.
func outboundFor(log, host, kind string) bool {
	for _, line := range strings.Split(log, "\n") {
		if strings.Contains(line, "outbound/"+kind) && strings.Contains(line, host) {
			return true
		}
	}
	return false
}
