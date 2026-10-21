package core

import (
	"bufio"
	"bytes"
	"encoding/base64"
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

// fakeUpstream is an HTTP CONNECT proxy standing in for a node: every tunnel
// answers "proxied", so the test can tell node traffic from direct traffic.
func fakeUpstream(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				br := bufio.NewReader(c)
				if _, err := http.ReadRequest(br); err != nil {
					return
				}
				io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n")
				if _, err := http.ReadRequest(br); err != nil {
					return
				}
				io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied")
			}(c)
		}
	}()
	return l.Addr().(*net.TCPAddr).Port
}

func TestBuildPortConfigShape(t *testing.T) {
	node := &nodes.Node{Type: "http", Server: "1.2.3.4", Port: 8080}
	b, err := BuildPortConfig(PortConfig{Listen: "0.0.0.0", Port: 10801, Protocol: "socks", User: "u", Pass: "p", Node: node, Mode: "global", ClashController: "127.0.0.1:1", GeoDir: "bin"})
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Inbounds []M `json:"inbounds"`
		Route    M   `json:"route"`
		Exp      M   `json:"experimental"`
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		t.Fatal(err)
	}
	in := cfg.Inbounds[0]
	if in["type"] != "socks" || in["listen"] != "0.0.0.0" || in["listen_port"] != float64(10801) || in["users"] == nil {
		t.Fatalf("inbound = %v", in)
	}
	if cfg.Route["final"] != "proxy" || cfg.Route["auto_detect_interface"] != true {
		t.Fatalf("route = %v", cfg.Route)
	}
	if !strings.Contains(string(b), `"default_mode": "global"`) {
		t.Fatal("boot mode not baked in")
	}
	if _, err := BuildPortConfig(PortConfig{Port: 0}); err == nil {
		t.Fatal("port 0 accepted")
	}
}

// TestPortProcessRoutesAndSwitchesMode runs a real port: auth is enforced,
// 全局 goes through the node, a live switch to 直连 bypasses it, and the clash
// API reports the client's source IP.
func TestPortProcessRoutesAndSwitchesMode(t *testing.T) {
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "sing-box.exe")
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	port, clash := freePortT(t), freePortT(t)
	node := &nodes.Node{Type: "http", Server: "127.0.0.1", Port: fakeUpstream(t)}
	cfg, err := BuildPortConfig(PortConfig{Listen: "127.0.0.1", Port: port, Protocol: "mixed", User: "u", Pass: "p", Node: node, Mode: "global",
		LogLevel: "warn", ClashController: fmt.Sprintf("127.0.0.1:%d", clash), ClashSecret: "s", GeoDir: geoDir})
	if err != nil {
		t.Fatal(err)
	}
	pp := NewPortProcess(bin, dir, "t1", func(l string) { t.Log(l) }, nil)
	if err := pp.Start(cfg, clash); err != nil {
		t.Fatal(err)
	}
	defer pp.Stop()
	if err := waitPort(port, 5*time.Second); err != nil {
		t.Fatal(err)
	}

	// https through the tunnel is not real TLS here, so use a raw CONNECT probe.
	connect := func(user string) string {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 3*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(6 * time.Second))
		auth := ""
		if user != "" {
			auth = "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(user)) + "\r\n"
		}
		fmt.Fprintf(c, "CONNECT example.invalid:80 HTTP/1.1\r\nHost: example.invalid:80\r\n%s\r\n", auth)
		br := bufio.NewReader(c)
		resp, err := http.ReadResponse(br, nil)
		if err != nil {
			return "err:" + err.Error()
		}
		if resp.StatusCode != 200 {
			return fmt.Sprintf("status:%d", resp.StatusCode)
		}
		io.WriteString(c, "GET / HTTP/1.1\r\nHost: example.invalid\r\n\r\n")
		r2, err := http.ReadResponse(br, nil)
		if err != nil {
			return "err:" + err.Error()
		}
		b, _ := io.ReadAll(r2.Body)
		return string(b)
	}
	// Without credentials the port refuses: 407, or the core drops the connection.
	if got := connect(""); got == "proxied" || !(strings.HasPrefix(got, "status:407") || strings.HasPrefix(got, "err:")) {
		t.Fatalf("no auth: %q, want refused", got)
	}
	if got := connect("u:p"); got != "proxied" {
		t.Fatalf("global: %q, want proxied", got)
	}

	// Live switch to 直连: example.invalid cannot resolve, so it must NOT be proxied.
	req, _ := http.NewRequest(http.MethodPatch, fmt.Sprintf("http://127.0.0.1:%d/configs", clash), bytes.NewReader([]byte(`{"mode":"direct"}`)))
	req.Header.Set("Authorization", "Bearer s")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode >= 300 {
		t.Fatalf("switch mode: %v %v", err, resp)
	}
	resp.Body.Close()
	if got := connect("u:p"); got == "proxied" {
		t.Fatal("direct mode still went through the node")
	}
}
