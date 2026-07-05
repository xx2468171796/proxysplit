// Command nodetest validates a real node end-to-end: parse link -> generate
// sing-box config -> start core -> fetch exit IP through its SOCKS inbound and
// compare with the direct IP. Usage: nodetest "<share-link>"
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

func fetchIP(client *http.Client) string {
	resp, err := client.Get("https://api.ipify.org?format=text")
	if err != nil {
		return "ERR: " + err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	return string(b)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: nodetest \"<share-link>\"")
		os.Exit(2)
	}
	node, err := nodes.ParseLink(os.Args[1])
	if err != nil {
		fmt.Println("parse FAILED:", err)
		os.Exit(1)
	}
	fmt.Printf("node: %s  [%s]  %s:%d  sni=%s flow=%s\n", node.Name, node.Type, node.Server, node.Port, node.SNI, node.Flow)

	// Direct baseline.
	direct := fetchIP(&http.Client{Timeout: 10 * time.Second})
	fmt.Println("direct exit IP:", direct)

	// Start the core with this node.
	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-nodetest")
	mgr := core.NewManager(filepath.Join(binDir, "sing-box.exe"), dataDir, func(l string) { fmt.Println("  [core]", l) })
	port, err := mgr.Start(node, 0, "info", core.Options{RemoteDNS: true})
	if err != nil {
		fmt.Println("core start FAILED:", err)
		os.Exit(1)
	}
	defer mgr.Stop()
	socks := fmt.Sprintf("127.0.0.1:%d", port)
	fmt.Println("core up, SOCKS on", socks)

	// Fetch exit IP through the node.
	d, _ := proxy.SOCKS5("tcp", socks, nil, proxy.Direct)
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return d.Dial(network, addr)
		},
	}
	client := &http.Client{Transport: tr, Timeout: 15 * time.Second}
	time.Sleep(500 * time.Millisecond)
	proxied := fetchIP(client)
	fmt.Println("proxied exit IP:", proxied)

	fmt.Println("---- RESULT ----")
	switch {
	case len(proxied) >= 7 && proxied[:4] != "ERR:" && proxied != direct:
		fmt.Printf("PASS: traffic exits via the node (%s), different from direct (%s).\n", proxied, direct)
	case proxied == direct && proxied[:4] != "ERR:":
		fmt.Println("WARN: proxied IP equals direct IP (node may not be routing, or same egress).")
	default:
		fmt.Println("FAIL: could not fetch exit IP through the node.")
	}
}
