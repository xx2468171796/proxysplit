package service

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Network probes for the AI environment check (aienv.go).

// traceResult is one service's Cloudflare trace: the exit the service sees.
type traceResult struct {
	ip, loc, colo string
	skew          time.Duration
	latency       time.Duration // median time to first byte of a few requests
	err           error
}

func probeClient() *http.Client {
	return &http.Client{Timeout: 6 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
}

// fetchTrace asks url (a /cdn-cgi/trace) three times: the exit from the first
// answer, the latency as the median, so one slow handshake does not decide it.
func fetchTrace(ctx context.Context, url string) traceResult {
	var r traceResult
	var times []time.Duration
	for i := 0; i < 3; i++ {
		one := fetchTraceOnce(ctx, url)
		if one.err != nil {
			if r.ip == "" {
				return one
			}
			break
		}
		if r.ip == "" {
			r = one
		}
		times = append(times, one.latency)
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	r.latency = times[len(times)/2]
	return r
}

func fetchTraceOnce(ctx context.Context, url string) traceResult {
	return traceWith(ctx, probeClient(), url)
}

// traceWith is one trace request through client (direct, or via a local proxy).
func traceWith(ctx context.Context, client *http.Client, url string) traceResult {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	sent := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return traceResult{err: err}
	}
	defer resp.Body.Close()
	r := traceResult{latency: time.Since(sent)}
	if d, err := http.ParseTime(resp.Header.Get("Date")); err == nil {
		r.skew = sent.Add(r.latency / 2).Sub(d)
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), "=")
		switch k {
		case "ip":
			r.ip = v
		case "loc":
			r.loc = v
		case "colo":
			r.colo = v
		}
	}
	if r.ip == "" {
		r.err = fmt.Errorf("HTTP %d，没拿到出口信息", resp.StatusCode)
	}
	return r
}

// ipInfo is what iplocate.io knows about an address (free, no key; tested
// 2026-10-23: HiNet → asn.type "isp", US IDC → "hosting").
type ipInfo struct {
	IP          string `json:"ip"`
	CountryCode string `json:"country_code"`
	City        string `json:"city"`
	TimeZone    string `json:"time_zone"`
	ASN         struct {
		ASN  string `json:"asn"`
		Name string `json:"name"`
		Type string `json:"type"` // isp | hosting | business | education …
	} `json:"asn"`
	Privacy struct {
		Abuser  bool `json:"is_abuser"`
		Hosting bool `json:"is_hosting"`
		Proxy   bool `json:"is_proxy"`
		Tor     bool `json:"is_tor"`
		VPN     bool `json:"is_vpn"`
	} `json:"privacy"`
}

// ipInfoURL: "" ip = the caller's own exit. A variable for tests.
var ipInfoURL = "https://iplocate.io/api/lookup/"

// lookupIP looks an address up ("" = whatever exit this request takes — not
// an AI host, so it is safe to ask while AI is not on our line).
func lookupIP(ctx context.Context, ip string) (ipInfo, error) {
	c, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(c, http.MethodGet, ipInfoURL+ip, nil)
	resp, err := probeClient().Do(req)
	if err != nil {
		return ipInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ipInfo{}, fmt.Errorf("IP 查询服务返回 HTTP %d", resp.StatusCode)
	}
	var info ipInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&info); err != nil {
		return ipInfo{}, err
	}
	return info, nil
}

// kind is the address type in plain words.
func (i ipInfo) kind() string {
	switch {
	case i.Privacy.Hosting || i.ASN.Type == "hosting":
		return "机房 IP"
	case i.ASN.Type == "isp":
		return "住宅宽带 IP"
	case i.ASN.Type == "business":
		return "企业 IP"
	case i.ASN.Type == "":
		return "类型未知"
	}
	return i.ASN.Type
}
