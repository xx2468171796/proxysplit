package subs

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
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

// Audit fix: a response that declares itself a POWER云 profile (the panel's
// X-PowerVPN-Sig-Type header) but does not verify must say so — parsed as a
// third-party subscription it would silently come out as zero nodes.
func TestFetchDeclaredProfileWithBadSignatureSaysUpgrade(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	v, _ := powervpn.NewVerifier(base64.RawURLEncoding.EncodeToString(pub))
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader) // e.g. the panel rotated its key
	declare := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := []byte(officialBody)
		w.Header().Set(powervpn.HeaderSignature, base64.RawURLEncoding.EncodeToString(ed25519.Sign(otherKey, powervpn.SignedMessage("profile", body))))
		if declare {
			w.Header().Set(powervpn.HeaderSigType, "profile")
		}
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	d := powervpn.Device{ID: strings.Repeat("c", 64), Name: "PC", OS: "windows"}
	pv := powervpn.NewWith(powervpn.Options{BaseURL: srv.URL, Version: "1.9.58", Verifier: v, Device: &d})
	_, err := FetchWith(srv.URL, "", pv)
	if !errors.Is(err, powervpn.ErrProfileSignature) || err.Error() != "POWER云 配置签名校验失败，请升级 ProxySplit" {
		t.Fatalf("err = %v", err)
	}
	if !errors.Is(err, powervpn.ErrBadSignature) {
		t.Fatal("must still be a signature error")
	}
	// Without a POWER云 client (plain Fetch) the declared profile is still reported.
	if _, err := FetchWith(srv.URL, "", nil); !errors.Is(err, powervpn.ErrProfileSignature) {
		t.Fatalf("plain fetch err = %v", err)
	}
	// No type header: unchanged compat path (the body is no subscription → error,
	// but not the POWER云 one, and never trusted).
	declare = false
	res, err := FetchWith(srv.URL, "", pv)
	if errors.Is(err, powervpn.ErrProfileSignature) || (err == nil && res.Official) {
		t.Fatalf("compat path changed: res=%+v err=%v", res, err)
	}
}

// A third-party subscription with an unrelated signature header and no type
// header keeps parsing as before.
func TestFetchThirdPartyWithStraySignatureHeaderStillParses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(powervpn.HeaderSignature, "not-a-signature")
		_, _ = w.Write([]byte("vless://0b1c2d3e-0000-4000-8000-000000000001@a.example.com:443?security=tls#n\n"))
	}))
	defer srv.Close()
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	v, _ := powervpn.NewVerifier(base64.RawURLEncoding.EncodeToString(pub))
	d := powervpn.Device{ID: strings.Repeat("c", 64), Name: "PC", OS: "windows"}
	pv := powervpn.NewWith(powervpn.Options{BaseURL: srv.URL, Version: "1.9.58", Verifier: v, Device: &d})
	res, err := FetchWith(srv.URL, "", pv)
	if err != nil || res.Official || len(res.Nodes) != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}
