// Command e2e exercises the FULL integrated stack: service -> app rule -> engine
// (WinDivert) -> core (sing-box) -> real node. It adds a real node, sets a rule
// for curl.exe, starts everything, then runs curl and checks the exit IP changed.
// Must run elevated. Usage: e2e "<share-link>"
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"proxysplit/internal/service"
)

func curlIP(proxOff bool) string {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "curl.exe", "-s", "--max-time", "10", "https://api.ipify.org").CombinedOutput()
	return string(out)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: e2e \"<share-link>\"")
		os.Exit(2)
	}
	binDir, _ := filepath.Abs("bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-e2e")
	os.RemoveAll(dataDir)

	svc, err := service.New(binDir, dataDir)
	if err != nil {
		fmt.Println("service:", err)
		os.Exit(1)
	}
	svc.SetLogSink(func(l string) { fmt.Println("  ", l) })

	added, skipped := svc.AddNodes(os.Args[1])
	fmt.Printf("added %d node(s), skipped %d\n", added, skipped)
	ns := svc.Nodes()
	if len(ns) == 0 {
		fmt.Println("no node parsed")
		os.Exit(1)
	}
	svc.SelectNode(ns[0].ID)
	svc.SetAppRules([]service.AppRule{{Match: "curl.exe", Path: "curl.exe", Line: "global", Enabled: true}})

	direct := curlIP(true)
	fmt.Println("direct exit IP:", direct)

	if err := svc.Start(); err != nil {
		fmt.Println("start:", err)
		os.Exit(1)
	}
	defer svc.Stop()
	time.Sleep(800 * time.Millisecond)

	proxied := curlIP(false)
	fmt.Println("proxied exit IP:", proxied)
	st := svc.Status()
	fmt.Printf("engine: running=%v activeConns=%d totalConns=%d up=%dB down=%dB uptime=%ds\n",
		st.EngineRunning, st.Stats.ActiveConns, st.Stats.TotalConns, st.Stats.UpBytes, st.Stats.DownBytes, st.UptimeSec)

	fmt.Println("---- RESULT ----")
	if len(proxied) >= 7 && proxied != direct && proxied[:4] != "ERR:" {
		fmt.Printf("PASS: full stack works — curl.exe routed through the node (%s), direct was %s.\n", proxied, direct)
	} else {
		fmt.Printf("FAIL: proxied=%q direct=%q\n", proxied, direct)
	}
}
