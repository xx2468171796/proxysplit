// Command quictest verifies QUIC (UDP/443) blocking end-to-end. As the harness it
// runs a UDP echo server on <lan-ip>:443 and the engine (blockQUIC, rule matching
// quictest.exe), then spawns itself as a child sender: with the engine up the
// child's datagram must be dropped (no echo); with the engine down it must echo.
// Must run elevated. The child mode is "send <ip>".
package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/engine"
)

func lanIP() string {
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				if ip := ipn.IP.To4(); ip != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
					return ip.String()
				}
			}
		}
	}
	return ""
}

func child(ip string) {
	conn, err := net.Dial("udp", ip+":443")
	if err != nil {
		fmt.Println("NOECHO")
		return
	}
	defer conn.Close()
	conn.Write([]byte("ping"))
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 16)
	if n, err := conn.Read(buf); err == nil && n > 0 {
		fmt.Println("ECHO")
	} else {
		fmt.Println("NOECHO")
	}
}

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "send" {
		child(os.Args[2])
		return
	}

	ip := lanIP()
	if ip == "" {
		fmt.Println("no LAN IP")
		os.Exit(1)
	}
	pc, err := net.ListenPacket("udp", ip+":443")
	if err != nil {
		fmt.Println("listen udp :443:", err)
		os.Exit(1)
	}
	defer pc.Close()
	go func() {
		buf := make([]byte, 64)
		for {
			n, a, e := pc.ReadFrom(buf)
			if e != nil {
				return
			}
			pc.WriteTo(buf[:n], a)
		}
	}()

	dll, _ := filepath.Abs(filepath.Join("bin", "WinDivert.dll"))
	m := engine.NewMatcher()
	m.SetRules([]engine.Rule{{Match: "quictest.exe", Target: "proxy", Enabled: true}}, engine.ModeBlacklist, engine.TargetDirect)
	eng := engine.New(dll, m, func(string) {})
	eng.SetBlockQUIC(true)
	eng.SetUpstreams(map[string]string{"proxy": ""})
	if err := eng.Start(); err != nil {
		fmt.Println("engine start:", err)
		os.Exit(1)
	}
	self, _ := os.Executable()
	time.Sleep(200 * time.Millisecond)

	out1, _ := exec.Command(self, "send", ip).Output()
	eng.Stop()
	time.Sleep(200 * time.Millisecond)
	out2, _ := exec.Command(self, "send", ip).Output()

	blocked := strings.TrimSpace(string(out1))
	unblocked := strings.TrimSpace(string(out2))
	fmt.Printf("with QUIC-block:    %s\nwithout QUIC-block: %s\n", blocked, unblocked)
	if blocked == "NOECHO" && unblocked == "ECHO" {
		fmt.Println("PASS: matched app's QUIC (UDP/443) is dropped when blocking is on, flows when off.")
	} else {
		fmt.Println("FAIL")
	}
}
