package core

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/nodes"
)

// End to end on real cores, no internet: client → sing-box → SOCKS → Xray
// sidecar → VLESS + XHTTP → a local Xray "server" → local HTTP server.
// Needs bin/sing-box.exe and bin/xray.exe (skipped otherwise).

const e2eUUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"

func startXrayServer(t *testing.T, xrayBin string) int {
	t.Helper()
	port, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	cfg := fmt.Sprintf(`{"log":{"loglevel":"warning"},
"inbounds":[{"listen":"127.0.0.1","port":%d,"protocol":"vless",
 "settings":{"clients":[{"id":%q}],"decryption":"none"},
 "streamSettings":{"network":"xhttp","xhttpSettings":{"path":"/e2e"}}}],
"dns":{"hosts":{"e2e.test":"127.0.0.1"}},
"outbounds":[{"protocol":"freedom","settings":{"domainStrategy":"UseIP","finalRules":[{"action":"allow"}]}}]}`, port, e2eUUID)
	path := filepath.Join(t.TempDir(), "server.json")
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(xrayBin, "run", "-c", path)
	cmd.Stdout, cmd.Stderr = tlog{t}, tlog{t}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	if err := waitPort(port, 5*time.Second); err != nil {
		t.Fatal("xray server did not start")
	}
	return port
}

func e2eSetup(t *testing.T) (singBox string, node *nodes.Node, target string) {
	t.Helper()
	singBox = singboxPath(t)
	xrayBin := XrayBinPath(singBox)
	if _, err := os.Stat(xrayBin); err != nil {
		t.Skip("xray.exe not present next to sing-box.exe")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "xray-ok") }))
	t.Cleanup(srv.Close)
	port := startXrayServer(t, xrayBin)
	n, err := nodes.ParseLink(fmt.Sprintf("vless://%s@127.0.0.1:%d?encryption=none&security=none&type=xhttp&path=%%2Fe2e&mode=packet-up#e2e", e2eUUID, port))
	if err != nil {
		t.Fatal(err)
	}
	// A domain only the Xray server resolves: proves the hop went through it
	// (sing-box would send a private IP direct).
	return singBox, n, strings.Replace(srv.URL, "127.0.0.1", "e2e.test", 1)
}

// tlog forwards the test Xray server's output to the test log.
type tlog struct{ t *testing.T }

func (w tlog) Write(p []byte) (int, error) {
	w.t.Log("[server] " + strings.TrimSpace(string(p)))
	return len(p), nil
}

func getVia(t *testing.T, socksAddr, url string) string {
	t.Helper()
	d, err := proxy.SOCKS5("tcp", socksAddr, nil, proxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Dial: d.Dial}}
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET through %s: %v", socksAddr, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

// Latency / speed tests use probes: an Xray node gets its own sidecar.
func TestXrayProbeEndToEnd(t *testing.T) {
	singBox, n, target := e2eSetup(t)
	p, err := StartProbe(singBox, t.TempDir(), n, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if got := getVia(t, p.Addr(), target); got != "xray-ok" {
		t.Fatalf("body = %q", got)
	}
}

// The main core starts the sidecar before sing-box and stops it after.
func TestXrayManagerLifecycle(t *testing.T) {
	singBox, n, target := e2eSetup(t)
	m := NewManager(singBox, t.TempDir(), func(l string) { t.Log(l) })
	port, err := m.Start(n, 0, "warn", Options{RouteMode: RouteGlobal})
	if err != nil {
		t.Fatal(err)
	}
	if !m.xray.Running() {
		t.Fatal("sidecar not running")
	}
	if got := getVia(t, fmt.Sprintf("127.0.0.1:%d", port), target); got != "xray-ok" {
		t.Fatalf("body = %q", got)
	}
	_ = m.Stop()
	if m.xray.Running() {
		t.Fatal("sidecar left running after Stop")
	}
}

// Proxy ports bind the physical interface (auto_detect_interface); the
// loopback hop to the sidecar must still work.
func TestXrayPortProxyEndToEnd(t *testing.T) {
	singBox, n, target := e2eSetup(t)
	data := t.TempDir()
	proc := NewPortProcess(singBox, data, "e2e", func(l string) { t.Log(l) }, nil)
	defer proc.Stop()
	ports, err := proc.PrepareXray(n)
	if err != nil {
		t.Fatal(err)
	}
	listen, _ := freePort()
	clash, _ := freePort()
	cfg, err := BuildPortConfig(PortConfig{Listen: "127.0.0.1", Port: listen, Protocol: "mixed", Node: n, Mode: "global",
		ClashController: fmt.Sprintf("127.0.0.1:%d", clash), GeoDir: mustAbs(t, filepath.Join("..", "..", "bin")), XrayPorts: ports})
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Start(cfg, clash); err != nil {
		t.Fatal(err)
	}
	if got := getVia(t, fmt.Sprintf("127.0.0.1:%d", listen), target); got != "xray-ok" {
		t.Fatalf("body = %q", got)
	}
}

// mustAbs: rule sets live in <repo>/bin on every OS (the macOS core is in bin/darwin).
func mustAbs(t *testing.T, p string) string {
	t.Helper()
	a, err := filepath.Abs(p)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
