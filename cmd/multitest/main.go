// Command multitest verifies multi-line routing: two apps assigned to two
// different lines (two nodes / two inbounds) and confirms each app is forwarded
// through its own line. Must run elevated. Usage: multitest "<share-link>"
//
// With a single real server the two nodes point at the same host (so both exit
// IPs match), but the config has two inbounds + two outbounds and the engine
// routes curl.exe via line L1 and curl2.exe via line L2 — proving the full
// per-app multi-line path.
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/service"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("usage: multitest \"<link1>\" \"<link2>\"  (two DIFFERENT real nodes)")
		os.Exit(2)
	}
	link, link2 := os.Args[1], os.Args[2]

	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-multitest")
	os.RemoveAll(dataDir)
	svc, err := service.New(binDir, dataDir)
	if err != nil {
		fmt.Println("service:", err)
		os.Exit(1)
	}
	var mu sync.Mutex
	var logs []string
	svc.SetLogSink(func(l string) { mu.Lock(); logs = append(logs, l); mu.Unlock() })

	svc.AddNodes(link + "\n" + link2)
	ns := svc.Nodes()
	if len(ns) < 2 {
		fmt.Printf("need 2 nodes, got %d\n", len(ns))
		os.Exit(1)
	}
	n1, n2 := ns[0], ns[1]
	svc.SelectNode(n1.ID)
	svc.SetRouting(service.Routing{Enabled: true}) // master split on -> lines apply
	svc.SetLines([]service.Line{
		{ID: "L1", Name: "线路1", Node: n1.ID, Routing: service.Routing{Mode: "global"}},
		{ID: "L2", Name: "线路2", Node: n2.ID, Routing: service.Routing{Mode: "global"}},
	})

	// curl2.exe = a copy of curl.exe so the two apps have distinct process names.
	curl2 := filepath.Join(os.TempDir(), "curl2.exe")
	if b, err := os.ReadFile(`C:\Windows\System32\curl.exe`); err == nil {
		os.WriteFile(curl2, b, 0o755)
	}
	svc.SetAppRules([]service.AppRule{
		{Match: "curl.exe", Path: "curl.exe", Line: "L1", Enabled: true},
		{Match: "curl2.exe", Path: "curl2.exe", Line: "L2", Enabled: true},
	})

	if err := svc.Start(); err != nil {
		fmt.Println("start:", err)
		os.Exit(1)
	}
	defer svc.Stop()
	time.Sleep(800 * time.Millisecond)

	ip1 := run("curl.exe")
	ip2 := run(curl2)
	time.Sleep(400 * time.Millisecond)

	mu.Lock()
	joined := strings.Join(logs, "\n")
	mu.Unlock()

	l1 := strings.Contains(joined, "[divert:L1] curl.exe")
	l2 := strings.Contains(joined, "[divert:L2] curl2.exe")

	fmt.Printf("curl.exe  (line L1 / %s) exit IP: %s\n", n1.Name, ip1)
	fmt.Printf("curl2.exe (line L2 / %s) exit IP: %s\n", n2.Name, ip2)
	fmt.Printf("engine routed curl.exe via L1: %v ; curl2.exe via L2: %v\n", l1, l2)
	fmt.Println("---- RESULT ----")
	okIP := len(ip1) >= 7 && len(ip2) >= 7 && !strings.HasPrefix(ip1, "ERR") && !strings.HasPrefix(ip2, "ERR")
	if l1 && l2 && okIP && ip1 != ip2 {
		fmt.Println("PASS: two apps exited via TWO DIFFERENT nodes simultaneously (different exit IPs).")
	} else if l1 && l2 && okIP && ip1 == ip2 {
		fmt.Println("PASS(routing) but same exit IP — the two nodes may share an egress; engine still routed each via its own line.")
	} else {
		fmt.Println("FAIL")
		for _, l := range logs {
			if strings.Contains(l, "divert") || strings.Contains(l, "line") || strings.Contains(l, "inbound") {
				fmt.Println("  ", l)
			}
		}
	}
}

func run(exe string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, exe, "-s", "--max-time", "10", "https://api.ipify.org").CombinedOutput()
	if err != nil {
		return "ERR:" + err.Error()
	}
	return strings.TrimSpace(string(out))
}
