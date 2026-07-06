// Command aria2test exercises per-app splitting for aria2c.exe specifically:
// it adds a real node, sets a rule matching "aria2c.exe" by NAME, starts the
// stack, then runs aria2c to download api.ipify.org and checks the exit IP.
// Must run elevated. Usage: aria2test "<share-link>" "<path-to-aria2c.exe>"
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

func aria2IP(aria2, dir string) string {
	out := filepath.Join(dir, "ip.txt")
	os.Remove(out)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, aria2,
		"--allow-overwrite=true", "--check-certificate=false", "--max-tries=1",
		"--connect-timeout=12", "--timeout=12", "-d", dir, "-o", "ip.txt",
		"https://api.ipify.org")
	b, _ := cmd.CombinedOutput()
	data, err := os.ReadFile(out)
	if err != nil {
		return "ERR:" + strings.TrimSpace(string(b))
	}
	return strings.TrimSpace(string(data))
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println(`usage: aria2test "<share-link>" "<path-to-aria2c.exe>"`)
		os.Exit(2)
	}
	link, aria2 := os.Args[1], os.Args[2]
	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-aria2")
	os.RemoveAll(dataDir)
	os.MkdirAll(dataDir, 0o755)

	svc, err := service.New(binDir, dataDir)
	if err != nil {
		fmt.Println("service:", err)
		os.Exit(1)
	}
	svc.SetLogSink(func(l string) { fmt.Println("  ", l) })

	added, _ := svc.AddNodes(link)
	ns := svc.Nodes()
	if added == 0 || len(ns) == 0 {
		fmt.Println("no node parsed")
		os.Exit(1)
	}
	svc.SelectNode(ns[0].ID)
	// Match by NAME (what a user's rule effectively becomes) -> line "global"
	// (all of aria2c's traffic through the active node).
	svc.SetAppRules([]service.AppRule{{Match: "aria2c.exe", Path: "aria2c.exe", Line: "global", Enabled: true}})

	direct := aria2IP(aria2, dataDir)
	fmt.Println("direct (aria2c) exit IP:", direct)

	if err := svc.Start(); err != nil {
		fmt.Println("start:", err)
		os.Exit(1)
	}
	defer svc.Stop()
	time.Sleep(900 * time.Millisecond)

	proxied := aria2IP(aria2, dataDir)
	fmt.Println("proxied (aria2c) exit IP:", proxied)
	st := svc.Status()
	fmt.Printf("engine: running=%v totalConns=%d up=%dB down=%dB\n",
		st.EngineRunning, st.Stats.TotalConns, st.Stats.UpBytes, st.Stats.DownBytes)

	fmt.Println("---- RESULT ----")
	if len(proxied) >= 7 && proxied != direct && !strings.HasPrefix(proxied, "ERR:") {
		fmt.Printf("PASS: aria2c.exe 分流成功 — 出口 %s(直连是 %s)\n", proxied, direct)
	} else {
		fmt.Printf("FAIL: proxied=%q direct=%q\n", proxied, direct)
	}
}
