package subs

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"proxysplit/internal/powervpn"
)

const officialBody = `{"version":1,"issuedAt":"x","accounts":[{"id":"a","name":"n","device":{"status":"active"},
"outbounds":[{"tag":"t","type":"vless","server":"s.com","server_port":443,"uuid":"u"}],"nodes":[{"tag":"t","outbound":"t"}]}]}`

func TestFetchOfficialProfileAndCompatFallback(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	v, _ := powervpn.NewVerifier(base64.RawURLEncoding.EncodeToString(pub))
	var ua, dev string
	sign := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua, dev = r.UserAgent(), r.Header.Get("X-Device-Id")
		body := []byte(officialBody)
		sig := ed25519.Sign(priv, powervpn.SignedMessage("profile", body))
		if !sign {
			sig = make([]byte, 64)
		}
		w.Header().Set(powervpn.HeaderSignature, base64.RawURLEncoding.EncodeToString(sig))
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	d := powervpn.Device{ID: strings.Repeat("c", 64), Name: "PC", OS: "windows"}
	pv := powervpn.NewWith(powervpn.Options{BaseURL: srv.URL, Version: "1.9.58", Verifier: v, Device: &d})
	res, err := FetchWith(srv.URL, "", pv)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Official || len(res.Nodes) != 1 || !res.Nodes[0].Official {
		t.Fatalf("%+v", res)
	}
	if !strings.HasPrefix(ua, "ProxySplit/1.9.58") || dev != d.ID {
		t.Fatalf("ua=%q dev=%q", ua, dev)
	}
	// Bad signature → compat parsing (a profile body is not a valid third-party
	// subscription, so it fails rather than being trusted).
	sign = false
	if res, err := FetchWith(srv.URL, "", pv); err == nil && res.Official {
		t.Fatal("unsigned profile trusted")
	}
}

func TestFetchThirdPartyGetsNoDeviceIdentity(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	v, _ := powervpn.NewVerifier(base64.RawURLEncoding.EncodeToString(pub))
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway) // endpoints unavailable → not POWER云
	}))
	defer panel.Close()
	var ua string
	var devHeaders []string
	third := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua = r.UserAgent()
		for _, h := range []string{"X-Device-Id", "X-Device-Name", "X-Device-OS"} {
			if r.Header.Get(h) != "" {
				devHeaders = append(devHeaders, h)
			}
		}
		_, _ = w.Write([]byte("vless://0b1c2d3e-0000-4000-8000-000000000001@a.example.com:443?security=tls#n\n"))
	}))
	defer third.Close()
	d := powervpn.Device{ID: strings.Repeat("c", 64), Name: "PC", OS: "windows"}
	pv := powervpn.NewWith(powervpn.Options{BaseURL: panel.URL, Version: "1.9.58", Verifier: v, Device: &d})
	res, err := FetchWith(third.URL, "", pv)
	if err != nil || res.Official || len(res.Nodes) != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if ua != "Clash.Meta" || len(devHeaders) != 0 {
		t.Fatalf("third-party saw ua=%q device headers=%v", ua, devHeaders)
	}
}
