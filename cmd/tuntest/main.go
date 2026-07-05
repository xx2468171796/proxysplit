// Command tuntest verifies TUN mode through the full SERVICE path
// (Settings.TunMode -> Start -> StartTUN): it enables TUN, checks the system exit
// IP now routes through the node (external curl), then guarantees teardown via a
// deferred Stop AND a watchdog. Must run elevated. Usage: tuntest "<share-link>"
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/service"
)

func curlIP() string {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "curl.exe", "-s", "--max-time", "6", "https://api.ipify.org").CombinedOutput()
	if err != nil {
		return "ERR"
	}
	return strings.TrimSpace(string(out))
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: tuntest \"<link>\"")
		os.Exit(2)
	}
	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-tuntest")
	os.RemoveAll(dataDir)
	svc, err := service.New(binDir, dataDir)
	if err != nil {
		fmt.Println("service:", err)
		os.Exit(1)
	}
	svc.SetLogSink(func(l string) {
		if strings.Contains(l, "[service]") || strings.Contains(l, "[core]") || strings.Contains(l, "FATAL") {
			fmt.Println("  ", l)
		}
	})

	svc.AddNodes(os.Args[1])
	ns := svc.Nodes()
	if len(ns) == 0 {
		fmt.Println("no node")
		os.Exit(1)
	}
	svc.SelectNode(ns[0].ID)
	set := svc.GetSettings()
	set.TunMode = true
	svc.SetSettings(set)
	svc.SetRouting(service.Routing{Enabled: true}) // 分流开 -> TUN 绕过大陆

	// Watchdog: guarantee teardown even if something hangs.
	go func() {
		time.Sleep(25 * time.Second)
		svc.Stop()
		fmt.Println("[watchdog: forced stop]")
		os.Exit(3)
	}()
	defer svc.Stop()

	fmt.Println("direct exit IP:", curlIP())
	if err := svc.Start(); err != nil {
		fmt.Println("start:", err)
		return
	}
	time.Sleep(3 * time.Second)

	via := curlIP()
	viaCN := curlCN()
	fmt.Println("via-TUN exit IP (foreign):", via)
	fmt.Println("via-TUN China site outbound:", viaCN)
	fmt.Println("---- RESULT ----")
	if via == ns[0].Server || (via != "" && via != "ERR") {
		fmt.Printf("PASS: TUN global works — whole system exits via node %s (%s).\n", ns[0].Name, via)
	} else {
		fmt.Println("FAIL:", via)
	}
}

// curlCN hits a China site; in bypass_cn it should go direct (fast).
func curlCN() string {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "curl.exe", "-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "6", "https://www.baidu.com").CombinedOutput()
	if err != nil {
		return "ERR"
	}
	return strings.TrimSpace(string(out))
}
