package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Another VPN / own node is allowed: only a hint, never a failure.
func TestLineItemOnlyHintsForOtherExits(t *testing.T) {
	if it := lineItem(AIEnvReport{ExitIP: "211.76.176.116", ExitOurs: true}, true); it.Status != "ok" {
		t.Fatalf("our exit: %+v", it)
	}
	if it := lineItem(AIEnvReport{ExitIP: "8.8.8.8"}, true); it.Status != "warn" {
		t.Fatalf("other VPN must be a warn hint, got %+v", it)
	}
	if it := lineItem(AIEnvReport{}, false); it.Status != "info" {
		t.Fatalf("no exit: %+v", it)
	}
}

func TestIPTypeItem(t *testing.T) {
	var home, idc, bad ipInfo
	home.ASN.Type = "isp"
	idc.ASN.Type = "hosting"
	bad.ASN.Type, bad.Privacy.Abuser = "isp", true
	for _, c := range []struct {
		info ipInfo
		err  error
		want string
	}{{home, nil, "ok"}, {idc, nil, "warn"}, {bad, nil, "fail"}, {ipInfo{}, errors.New("x"), "info"}} {
		if it := ipTypeItem(c.info, c.err); it.Status != c.want {
			t.Errorf("%+v: got %s, want %s", c.info, it.Status, c.want)
		}
	}
}

func TestConsistencyAndLatency(t *testing.T) {
	same := []traceResult{{ip: "1.1.1.1", latency: 300 * time.Millisecond}, {ip: "1.1.1.1", latency: 400 * time.Millisecond}}
	if consistencyItem(same).Status != "ok" || latencyItem(same).Status != "ok" {
		t.Fatal("same fast exit should pass")
	}
	split := []traceResult{{ip: "1.1.1.1", latency: time.Second}, {ip: "2001:db8::1", latency: 300 * time.Millisecond}}
	if consistencyItem(split).Status != "warn" || latencyItem(split).Status != "warn" {
		t.Fatal("different exits / 1 s should warn")
	}
	down := []traceResult{{ip: "1.1.1.1"}, {err: errors.New("timeout")}}
	if latencyItem(down).Status != "fail" || consistencyItem(down).Status != "info" {
		t.Fatal("unreachable service")
	}
}

// The median ignores one slow handshake.
func TestFetchTraceMedian(t *testing.T) {
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		if n == 1 {
			time.Sleep(300 * time.Millisecond)
		}
		w.Write([]byte("ip=1.2.3.4\nloc=TW\ncolo=TPE\n"))
	}))
	defer srv.Close()
	tr := fetchTrace(context.Background(), srv.URL)
	if tr.err != nil || tr.ip != "1.2.3.4" || tr.colo != "TPE" || n != 3 {
		t.Fatalf("trace %+v after %d requests", tr, n)
	}
	if tr.latency > 200*time.Millisecond {
		t.Fatalf("median %s took the slow request", tr.latency)
	}
}

func TestLookupIP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ip":"122.116.1.113","country_code":"TW","city":"Taipei","asn":{"asn":"AS3462","name":"HiNet","type":"isp"},"privacy":{"is_hosting":false}}`))
	}))
	defer srv.Close()
	old := ipInfoURL
	ipInfoURL = srv.URL + "/"
	defer func() { ipInfoURL = old }()
	info, err := lookupIP(context.Background(), "")
	if err != nil || info.IP != "122.116.1.113" || info.kind() != "住宅宽带 IP" {
		t.Fatalf("%+v %v", info, err)
	}
}
