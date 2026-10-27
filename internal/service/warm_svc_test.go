package service

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

func TestAIGuardSkip(t *testing.T) {
	skip := aiGuardSkip(&core.AIGuard{DomainSuffixes: []string{"anthropic.com", ".openai.com"}, Domains: []string{"chatgpt.com"}})
	for host, want := range map[string]bool{
		"anthropic.com": true, "api.anthropic.com": true, "API.OpenAI.com.": true, "chatgpt.com": true,
		"x.chatgpt.com": false, "notanthropic.com": false, "www.google.com": false,
	} {
		if skip(host) != want {
			t.Errorf("%s: %v", host, !want)
		}
	}
	if aiGuardSkip(nil)("anthropic.com") {
		t.Fatal("nil guard skips")
	}
}

// fakeClash serves /connections and /dns/query like sing-box's Clash API.
func fakeClash(t *testing.T) int {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/connections", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer s3" {
			http.Error(w, "unauthorized", 401)
			return
		}
		_, _ = w.Write([]byte(`{"connections":[
			{"metadata":{"host":"www.google.com"},"chains":["proxy"]},
			{"metadata":{"host":"api.anthropic.com"},"chains":["node-ai"]},
			{"metadata":{"host":"www.baidu.com"},"chains":["direct"]},
			{"metadata":{"host":"","destinationIP":"8.8.8.8"},"chains":["proxy"]},
			{"metadata":{"host":"github.com"},"chains":["node-x"]}]}`))
	})
	mux.HandleFunc("/dns/query", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") == "nx.example" {
			_, _ = w.Write([]byte(`{"Status":3}`))
			return
		}
		_, _ = w.Write([]byte(`{"Status":0,"Answer":[{"TTL":1,"data":"1.2.3.4","name":"x.","type":1}]}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	_, p, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	port, _ := strconv.Atoi(p)
	return port
}

func TestProxiedHostsAndDNSQuery(t *testing.T) {
	port := fakeClash(t)
	skip := aiGuardSkip(&core.AIGuard{DomainSuffixes: []string{"anthropic.com"}})
	got := strings.Join(proxiedHosts(port, "s3", skip), ",")
	if got != "www.google.com,github.com" {
		t.Fatalf("hosts %s", got)
	}
	if err := clashDNSQuery(context.Background(), port, "s3", "www.google.com"); err != nil {
		t.Fatal(err)
	}
	if err := clashDNSQuery(context.Background(), port, "s3", "nx.example"); err == nil {
		t.Fatal("NXDOMAIN counted as ok")
	}
}

func TestStartNodesAndProbePort(t *testing.T) {
	main := &nodes.Node{ID: "a", Type: "vless", Server: "a.example", Port: 443}
	hy := &nodes.Node{ID: "b", Type: "hysteria2", Server: "b.example", Port: 443}
	opts := core.Options{ExtraNodes: []core.ExtraNode{{Tag: "x", Node: hy}}}
	list := startNodes(main, &opts)
	if len(list) != 2 || probePort(list[0]) != 443 || probePort(list[1]) != 0 {
		t.Fatalf("%v", list)
	}
	if needsResolve(&nodes.Node{Server: "1.2.3.4"}) || !needsResolve(main) || needsResolve(nil) {
		t.Fatal("needsResolve")
	}
}
