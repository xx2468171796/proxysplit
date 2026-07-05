// Command divtest exercises the WinDivert redirect engine end-to-end without a
// live proxy node. It starts a local "remote" HTTP server on the machine's LAN
// IP, configures the engine to match curl.exe in direct-forward mode, then runs
// curl against that server. Success requires that curl's connection was captured
// and NATed through the redirector (proven by the engine's connection counter).
//
// Must be run elevated (WinDivert loads a kernel driver).
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"proxysplit/internal/engine"
)

func lanIP() (net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				ip := ipn.IP.To4()
				if ip != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
					return ip, nil
				}
			}
		}
	}
	return nil, fmt.Errorf("no LAN IPv4 found")
}

func main() {
	logf := func(s string) { fmt.Println("  ", s) }

	ip, err := lanIP()
	if err != nil {
		fmt.Println("FATAL:", err)
		os.Exit(1)
	}
	fmt.Println("LAN IP:", ip)

	// "Remote" server bound on the LAN IP so connections to it are non-loopback
	// and thus subject to capture.
	const token = "REACHED-VIA-REDIRECTOR-b7f3"
	ln, err := net.Listen("tcp", net.JoinHostPort(ip.String(), "0"))
	if err != nil {
		fmt.Println("FATAL server listen:", err)
		os.Exit(1)
	}
	srvPort := ln.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, token) })
	go http.Serve(ln, mux)
	target := fmt.Sprintf("http://%s:%d/", ip, srvPort)
	fmt.Println("remote server:", target)

	// Engine matching curl.exe, direct-forward mode (upstream = "").
	dll, _ := filepath.Abs(filepath.Join("bin", "WinDivert.dll"))
	m := engine.NewMatcher()
	m.SetRules([]engine.Rule{{Match: "curl.exe", Target: "proxy", Enabled: true}}, engine.ModeBlacklist, engine.TargetDirect)
	eng := engine.New(dll, m, logf)
	eng.SetBlockQUIC(true)                              // exercise the UDP/443 capture filter path
	eng.SetUpstreams(map[string]string{"proxy": ""})    // direct forward for the mechanics test
	if err := eng.Start(); err != nil {
		fmt.Println("FATAL engine start:", err)
		os.Exit(1)
	}
	defer eng.Stop()
	fmt.Println("engine started; running curl through it...")
	time.Sleep(300 * time.Millisecond)

	// Run curl (a separate process, so its PID differs and matches the rule).
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "curl.exe", "-s", "--max-time", "6", target).CombinedOutput()
	body := string(out)

	time.Sleep(200 * time.Millisecond)
	st := eng.Stats()

	fmt.Println("---- RESULT ----")
	fmt.Printf("curl err:      %v\n", err)
	fmt.Printf("curl body:     %q\n", body)
	fmt.Printf("engine total:  %d\n", st.TotalConns)
	fmt.Printf("engine active: %d\n", st.ActiveConns)

	switch {
	case body == token && st.TotalConns >= 1:
		fmt.Println("PASS: curl reached the server AND was intercepted/NATed by the engine.")
	case body == token && st.TotalConns == 0:
		fmt.Println("PARTIAL: curl succeeded but engine counted 0 conns (curl went direct, not intercepted).")
	default:
		fmt.Println("FAIL: curl did not get the expected body through the redirector.")
	}
}
