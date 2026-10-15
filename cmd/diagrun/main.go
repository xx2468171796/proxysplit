// Command diagrun runs ProxySplit's routing self-test headless on any Windows
// machine (no UI, no login): it starts the real core with the given node and
// app rules in a throwaway data dir, runs the built-in SelfTest plus optional
// route tests, prints JSON, and always stops the core (deferred Stop + a
// watchdog). Must run elevated (TUN).
//
//	diagrun -link - < link.txt -mode whitelist -app chrome.exe=rule \
//	        -custom suffix:ifconfig.me:proxy -test chrome.exe=https://www.baidu.com
//
// Layout: diagrun.exe next to a bin\ folder holding sing-box.exe + *.srs.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
	"proxysplit/internal/service"
)

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(v string) error { *m = append(*m, v); return nil }

func main() {
	var apps, customs, tests multi
	link := flag.String("link", "", "node share link (required)")
	mode := flag.String("mode", "whitelist", "whitelist | blacklist | tun (整机全局)")
	clash := flag.String("clash", "rule", "代理策略 rule | global | direct")
	limit := flag.Duration("limit", 4*time.Minute, "hard stop (watchdog)")
	selftest := flag.Bool("selftest", true, "run the built-in self-test")
	logLevel := flag.String("loglevel", "info", "core log level")
	cold := flag.Duration("cold", 0, "watch DNS right after start for this long (fresh names every 300ms)")
	flag.Var(&apps, "app", "app rule name=line (line: rule|global|direct|block), repeatable")
	flag.Var(&customs, "custom", "custom rule type:value:action, repeatable")
	flag.Var(&tests, "test", "extra route test process=url, repeatable")
	flag.Parse()
	if *link == "-" { // read from stdin so the secret stays out of the command line
		b, _ := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
		*link = strings.TrimSpace(string(b))
	}
	if *link == "" {
		fmt.Fprintln(os.Stderr, "-link is required (use - to read it from stdin)")
		os.Exit(2)
	}

	exe, _ := os.Executable()
	binDir := filepath.Join(filepath.Dir(exe), "bin")
	dataDir := filepath.Join(os.TempDir(), "proxysplit-diagrun")
	os.RemoveAll(dataDir)
	svc, err := service.New(binDir, dataDir)
	if err != nil {
		fail(err)
	}
	svc.SetLogSink(func(string) {})
	svc.SetLogLevel(*logLevel)
	added, skipped := svc.AddNodes(*link)
	ns := svc.Nodes()
	if len(ns) == 0 {
		_, perr := nodes.ParseLink(*link)
		fail(fmt.Errorf("node link not accepted (len %d, added %d, skipped %d, parse: %v)", len(*link), added, skipped, perr))
	}
	svc.SelectNode(ns[0].ID)
	set := svc.GetSettings()
	set.TunMode = *mode == "tun"
	svc.SetSettings(set)
	if *mode != "tun" {
		check("split mode", svc.SetRuleMode(*mode))
	}
	var rules []service.AppRule
	for _, a := range apps {
		name, line, _ := strings.Cut(a, "=")
		rules = append(rules, service.AppRule{Match: name, Line: line, Enabled: true})
	}
	check("app rules", svc.SetAppRules(rules))
	var crs []core.RouteRule
	for _, c := range customs {
		p := strings.SplitN(c, ":", 3)
		if len(p) == 3 {
			crs = append(crs, core.RouteRule{Type: p[0], Value: p[1], Action: p[2]})
		}
	}
	check("custom rules", svc.SetCustomRules(crs))
	if err := svc.SetClashMode(*clash); err != nil {
		fail(err)
	}

	go func() {
		time.Sleep(*limit)
		svc.Stop()
		fmt.Fprintln(os.Stderr, "[watchdog: forced stop]")
		os.Exit(3)
	}()
	defer svc.Stop()
	if err := svc.Start(); err != nil {
		fail(err)
	}
	out := map[string]any{}
	if *cold > 0 {
		out["coldDNS"] = coldDNS(*cold)
		out["coreDNSLog"] = svc.RecentLogs(400, "dns")
	} else {
		time.Sleep(4 * time.Second)
	}
	if *selftest {
		out["selftest"] = svc.SelfTest()
	} else {
		out["diag"] = svc.Diagnose()
	}
	var extra []service.RouteTestResult
	for _, t := range tests {
		proc, url, _ := strings.Cut(t, "=")
		extra = append(extra, svc.RouteTest(proc, url))
	}
	out["tests"] = extra
	b, _ := json.MarshalIndent(out, "", " ")
	fmt.Println(string(b))
}

type coldLookup struct {
	AtMs   int64  `json:"atMs"` // since start returned
	Host   string `json:"host"`
	Millis int64  `json:"ms"`
	Result string `json:"result"` // ok | nxdomain | timeout | error text
}

// coldNames are real hosts, each looked up once (no OS cache hit).
var coldNames = []string{
	"news.baidu.com", "mail.google.com", "map.qq.com", "tieba.baidu.com", "maps.google.com", "v.qq.com",
	"zhidao.baidu.com", "drive.google.com", "music.qq.com", "baike.baidu.com", "docs.google.com", "sports.qq.com",
	"fanyi.baidu.com", "play.google.com", "mail.qq.com", "wenku.baidu.com", "news.google.com", "y.qq.com",
	"pan.baidu.com", "translate.google.com", "im.qq.com", "image.baidu.com", "photos.google.com", "weixin.qq.com",
}

// coldDNS resolves never-seen names right after start every 300ms — real
// hosts (mainland and foreign) and one nonexistent name per round — to catch
// DNS that is broken or slow while the core warms up.
func coldDNS(d time.Duration) []coldLookup {
	var out []coldLookup
	begin := time.Now()
	for i := 0; time.Since(begin) < d; i++ {
		hosts := []string{fmt.Sprintf("ps%d%d.baidu.com", time.Now().UnixNano()%1e9, i)}
		if i < len(coldNames) {
			hosts = append([]string{coldNames[i]}, hosts...)
		}
		for _, host := range hosts {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			at := time.Since(begin).Milliseconds()
			start := time.Now()
			_, err := net.DefaultResolver.LookupHost(ctx, host)
			cancel()
			res := "ok"
			var de *net.DNSError
			switch {
			case err == nil:
			case errors.As(err, &de) && de.IsNotFound:
				res = "nxdomain"
			case errors.As(err, &de) && de.IsTimeout, errors.Is(err, context.DeadlineExceeded):
				res = "timeout"
			default:
				res = err.Error()
			}
			out = append(out, coldLookup{AtMs: at, Host: host, Millis: time.Since(start).Milliseconds(), Result: res})
		}
		time.Sleep(300 * time.Millisecond)
	}
	return out
}

func check(what, msg string) {
	if msg != "" {
		fail(fmt.Errorf("%s: %s", what, msg))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "diagrun:", err)
	os.Exit(1)
}
