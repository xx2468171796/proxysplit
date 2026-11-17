package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

// connectVia asks an HTTP proxy for a CONNECT tunnel to target and reads one
// HTTP response through it; "refused" when the proxy would not open it.
func connectVia(t *testing.T, proxyPort int, target string) string {
	t.Helper()
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", proxyPort), 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(6 * time.Second))
	fmt.Fprintf(c, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
	br := bufio.NewReader(c)
	resp, err := http.ReadResponse(br, nil)
	if err != nil || resp.StatusCode != 200 {
		return "refused"
	}
	fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", target)
	r2, err := http.ReadResponse(br, nil)
	if err != nil {
		return "refused"
	}
	b, _ := io.ReadAll(r2.Body)
	return string(b)
}

// A proxy port shared with the LAN (0.0.0.0, no credentials) must not be a way
// into this machine's own loopback services: `ip_is_private → direct` used to
// hand a LAN client anything listening on 127.0.0.1 — other local proxies, dev
// servers, the control API.
func TestLANSharedPortCannotReachLoopback(t *testing.T) {
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "sing-box.exe")
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	local := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "loopback secret") })}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go local.Serve(ln)
	t.Cleanup(func() { local.Close() })
	localPort := ln.Addr().(*net.TCPAddr).Port

	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	start := func(listen string) int {
		port, clash := freePortT(t), freePortT(t)
		cfg, err := BuildPortConfig(PortConfig{Listen: listen, Port: port, Protocol: "mixed", Node: &nodes.Node{Type: "http", Server: "127.0.0.1", Port: fakeUpstream(t)},
			Mode: "rule", LogLevel: "warn", ClashController: fmt.Sprintf("127.0.0.1:%d", clash), ClashSecret: "s", GeoDir: geoDir})
		if err != nil {
			t.Fatal(err)
		}
		pp := NewPortProcess(bin, dir, fmt.Sprintf("lan-%d", port), func(l string) { t.Log(l) }, nil)
		if err := pp.Start(cfg, clash); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pp.Stop)
		if err := waitPort(port, 5*time.Second); err != nil {
			t.Fatal(err)
		}
		return port
	}

	shared := start("0.0.0.0")
	for _, target := range []string{fmt.Sprintf("127.0.0.1:%d", localPort), fmt.Sprintf("localhost:%d", localPort)} {
		if got := connectVia(t, shared, target); got == "loopback secret" {
			t.Fatalf("a LAN-shared port reached %s on this machine", target)
		}
	}
	// A port for this machine only keeps reaching local services (its only
	// clients are local programs, which can reach them anyway).
	private := start("127.0.0.1")
	if got := connectVia(t, private, fmt.Sprintf("127.0.0.1:%d", localPort)); got != "loopback secret" {
		t.Fatalf("a loopback-only port must still reach local services, got %q", got)
	}
}

// ruleIndex returns the position of the first route rule fn accepts (-1: none).
func ruleIndex(t *testing.T, cfg []byte, fn func(r map[string]any) bool) int {
	t.Helper()
	var doc struct {
		Route struct {
			Rules []map[string]any `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(cfg, &doc); err != nil {
		t.Fatal(err)
	}
	for i, r := range doc.Route.Rules {
		if fn(r) {
			return i
		}
	}
	return -1
}

func isLANGuard(inbound string) func(map[string]any) bool {
	return func(r map[string]any) bool {
		in, _ := r["inbound"].([]any)
		cidrs, _ := r["ip_cidr"].([]any)
		return len(in) == 1 && in[0] == inbound && r["action"] == "reject" && len(cidrs) > 0 && cidrs[0] == "127.0.0.0/8"
	}
}

// In every config with a LAN inbound the guard comes before anything that can
// send its traffic direct, and a config without one does not carry it.
func TestLANGuardPrecedesDirectRules(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	private := func(r map[string]any) bool { return r["ip_is_private"] == true && r["outbound"] == "direct" }
	clashDirect := func(r map[string]any) bool { return r["clash_mode"] == "direct" && r["outbound"] == "direct" }

	lan := Options{GeoDir: "GEO", RouteMode: RouteBypassCN, LanShare: true, LanPort: 7891, ClashController: "127.0.0.1:19095", ClashSecret: "s", AccelPort: 19096}
	tun, err := BuildTUNConfig(node, "info", lan)
	if err != nil {
		t.Fatal(err)
	}
	guard := ruleIndex(t, tun, isLANGuard("in-lan"))
	if guard < 0 || guard > ruleIndex(t, tun, private) || guard > ruleIndex(t, tun, clashDirect) {
		t.Fatalf("TUN: LAN guard at %d must precede private-direct (%d) and 直连 mode (%d)", guard, ruleIndex(t, tun, private), ruleIndex(t, tun, clashDirect))
	}
	// Its own local ports are closed to LAN clients on private addresses too
	// (the machine's LAN address reaches services bound to every interface).
	ports := ruleIndex(t, tun, func(r map[string]any) bool {
		in, _ := r["inbound"].([]any)
		return len(in) == 1 && in[0] == "in-lan" && r["ip_is_private"] == true && r["action"] == "reject" && strings.Contains(fmt.Sprint(r["port"]), "19095")
	})
	if ports < 0 || ports > ruleIndex(t, tun, private) {
		t.Fatalf("TUN: own-port guard missing or too late (%d)", ports)
	}

	multi, err := BuildMultiConfig([]LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}, "info", lan)
	if err != nil {
		t.Fatal(err)
	}
	if g := ruleIndex(t, multi, isLANGuard("in-lan")); g < 0 || g > ruleIndex(t, multi, clashDirect) {
		t.Fatalf("multi: LAN guard at %d must precede 直连 mode (%d)", g, ruleIndex(t, multi, clashDirect))
	}

	off := lan
	off.LanShare = false
	plain, err := BuildTUNConfig(node, "info", off)
	if err != nil {
		t.Fatal(err)
	}
	if ruleIndex(t, plain, isLANGuard("in-lan")) >= 0 {
		t.Fatal("no LAN inbound: no guard rule")
	}
}
