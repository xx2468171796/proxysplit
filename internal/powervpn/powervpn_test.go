package powervpn

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type signer struct {
	priv ed25519.PrivateKey
	v    Verifier
}

func newSigner(t *testing.T) signer {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	v, err := NewVerifier(base64.RawURLEncoding.EncodeToString(pub))
	if err != nil {
		t.Fatal(err)
	}
	return signer{priv: priv, v: v}
}

func (s signer) write(w http.ResponseWriter, typ string, body []byte) {
	w.Header().Set(HeaderSignature, base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.priv, SignedMessage(typ, body))))
	w.Header().Set(HeaderSigType, typ)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

const profileJSON = `{"version":1,"issuedAt":"2026-09-29T00:00:00Z","accounts":[
 {"id":"acc1","name":"主账号","expiresAt":null,"traffic":{"usedBytes":1,"capBytes":null},"maxDevices":3,
  "device":{"status":"active","message":""},
  "outbounds":[
   {"tag":"节点 1 · 台湾","type":"urltest","outbounds":["节点 1 · 台湾 · mux","节点 1 · 台湾 · 兼容"],"interval":"3m"},
   {"tag":"节点 1 · 台湾 · mux","type":"vless","server":"tw.example.net","server_port":443,"uuid":"dev-uuid","flow":"","multiplex":{"enabled":true,"protocol":"h2mux","brutal":{"enabled":true,"up_mbps":50,"down_mbps":200}}},
   {"tag":"节点 1 · 台湾 · 兼容","type":"vless","server":"tw.example.net","server_port":443,"uuid":"dev-uuid","flow":"xtls-rprx-vision"}
  ],
  "nodes":[{"tag":"节点 1 · 台湾","outbound":"节点 1 · 台湾"}],
  "egress":{"mode":"ai_only","revision":3,"allow":{"domains":[],"domainSuffixes":["anthropic.com"],"domainKeywords":[],"ipCidrs":["160.79.104.0/23"]}}},
 {"id":"acc2","name":"副账号","device":{"status":"limit_reached","message":"设备数已满（3/3）"},"outbounds":[],"nodes":[]}
]}`

func TestVerifyAndProfileNodes(t *testing.T) {
	s := newSigner(t)
	body := []byte(profileJSON)
	h := http.Header{}
	h.Set(HeaderSignature, base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.priv, SignedMessage(SigTypeProfile, body))))
	h.Set(HeaderSigType, SigTypeProfile)
	p, err := ParseSignedProfile(s.v, h, body)
	if err != nil {
		t.Fatal(err)
	}
	list, notices := p.Nodes()
	if len(list) != 1 || len(notices) != 1 || !strings.Contains(notices[0], "设备数已满") {
		t.Fatalf("nodes=%d notices=%v", len(list), notices)
	}
	n := list[0]
	if !n.Official || n.EntryTag != "节点 1 · 台湾" || len(n.Outbounds) != 3 || n.Server != "tw.example.net" || n.Port != 443 || n.Type != "urltest" {
		t.Fatalf("unexpected node %+v", n)
	}
	if !n.Egress.Restricted() || n.Egress.Allow == nil || len(n.Egress.Allow.DomainSuffixes) != 1 || n.Egress.Allow.IPCIDRs[0] != "160.79.104.0/23" {
		t.Fatalf("仅 AI egress not carried onto the node: %+v", n.Egress)
	}
	// Tampered body, wrong type, other key, no key all fail.
	if _, err := ParseSignedProfile(s.v, h, append(body, ' ')); err == nil {
		t.Fatal("tampered body accepted")
	}
	h2 := h.Clone()
	h2.Set(HeaderSigType, SigTypeEndpoints)
	if _, err := ParseSignedProfile(s.v, h2, body); err == nil {
		t.Fatal("wrong signature type accepted")
	}
	if _, err := ParseSignedProfile(newSigner(t).v, h, body); err == nil {
		t.Fatal("foreign key accepted")
	}
	if _, err := ParseSignedProfile(DefaultVerifier(), h, body); err == nil && PanelPublicKey == "" {
		t.Fatal("empty panel key must reject")
	}
}

func TestDeviceID(t *testing.T) {
	id := DeviceIDFor("machine-guid=abc")
	if len(id) != 64 || id != strings.ToLower(id) || id == DeviceIDFor("other") {
		t.Fatalf("bad device id %q", id)
	}
}

func testClient(t *testing.T, srv *httptest.Server, s signer) *Client {
	dev := Device{ID: strings.Repeat("a", 64), Name: "PC", OS: "windows 10.0.26100"}
	return NewWith(Options{BaseURL: srv.URL, DataDir: t.TempDir(), Version: "1.9.58", HTTP: srv.Client(), Verifier: s.v, Device: &dev,
		Seal: func(b []byte) ([]byte, error) { return append([]byte("sealed:"), b...), nil },
		Open: func(b []byte) ([]byte, error) { return []byte(strings.TrimPrefix(string(b), "sealed:")), nil }})
}

func TestOAuthLoginRefreshAndProfile(t *testing.T) {
	s := newSigner(t)
	var challenge string
	var refreshes atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		var f map[string]string
		_ = json.NewDecoder(r.Body).Decode(&f)
		switch f["grant_type"] {
		case "authorization_code":
			sum := sha256sum(f["code_verifier"])
			if f["code"] != "the-code" || sum != challenge || f["client_id"] != ClientID || !strings.HasPrefix(f["redirect_uri"], "http://127.0.0.1:") {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"at1","refresh_token":"rt1","token_type":"Bearer","expires_in":1}`))
		case "refresh_token":
			if f["refresh_token"] != "rt1" {
				w.WriteHeader(400)
				return
			}
			refreshes.Add(1)
			_, _ = w.Write([]byte(`{"access_token":"at2","refresh_token":"rt2","token_type":"Bearer","expires_in":3600}`))
		}
	})
	mux.HandleFunc("/api/client/me", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"u1","username":"bob","email":"b@x","displayName":"Bob"}`))
	})
	mux.HandleFunc("/api/client/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer at2" || r.Header.Get("X-Device-Id") != strings.Repeat("a", 64) || r.UserAgent() != "ProxySplit/1.9.58" {
			w.WriteHeader(401)
			return
		}
		s.write(w, SigTypeProfile, []byte(profileJSON))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)

	open := func(authURL string) error {
		u, _ := url.Parse(authURL)
		q := u.Query()
		challenge = q.Get("code_challenge")
		if q.Get("client_id") != ClientID || q.Get("code_challenge_method") != "S256" {
			return errors.New("bad authorize url")
		}
		go func() {
			// A forged state is rejected without ending the flow.
			bad, _ := http.Get(q.Get("redirect_uri") + "?code=evil&state=wrong")
			if bad != nil {
				bad.Body.Close()
			}
			resp, err := http.Get(q.Get("redirect_uri") + "?code=the-code&state=" + url.QueryEscape(q.Get("state")))
			if err == nil {
				resp.Body.Close()
			}
		}()
		return nil
	}
	if err := c.Login(context.Background(), open); err != nil {
		t.Fatal(err)
	}
	if !c.LoggedIn() || c.Username() != "Bob" {
		t.Fatalf("login state: %v %q", c.LoggedIn(), c.Username())
	}
	// at1 expires in 1s (< leeway) → refresh to at2 before the profile call.
	p, err := c.Profile(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Accounts) != 2 || refreshes.Load() != 1 {
		t.Fatalf("accounts=%d refreshes=%d", len(p.Accounts), refreshes.Load())
	}
	// Token persisted (sealed) and reloaded.
	c2 := NewWith(Options{BaseURL: srv.URL, DataDir: c.dataDir, Verifier: s.v, Open: c.open, Seal: c.seal})
	if !c2.LoggedIn() {
		t.Fatal("token not persisted")
	}
	_ = c.Logout()
	if c.LoggedIn() {
		t.Fatal("logout kept token")
	}
}

func TestEndpointsCacheClaimAndCore(t *testing.T) {
	s := newSigner(t)
	var hits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/endpoints", func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		s.write(w, SigTypeEndpoints, EndpointsBody("salt1", "tw.example.net", "203.0.113.9", "2001:db8::1"))
	})
	mux.HandleFunc("/api/client/devices/claim", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["uuid"] != "known" {
			w.WriteHeader(404)
			return
		}
		s.write(w, SigTypeProfile, []byte(profileJSON))
	})
	mux.HandleFunc("/api/client/core", func(w http.ResponseWriter, r *http.Request) {
		s.write(w, SigTypeCore, []byte(`{"version":"1.14.2","build":"relayops.6","sha256":"`+strings.Repeat("b", 64)+`","url":"/api/client/core/download/sb.exe"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		eps, err := c.Endpoints(ctx)
		if err != nil || !eps.Match("TW.example.net.") || !eps.Match("[203.0.113.9]") || !eps.Match("[2001:DB8:0::1]") || eps.Match("other") || eps.Match("example.net") {
			t.Fatalf("eps=%v err=%v", eps, err)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("endpoints not cached: %d", hits.Load())
	}
	c.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	_, _ = c.Endpoints(ctx)
	if hits.Load() != 2 {
		t.Fatal("stale cache not refreshed")
	}
	if _, err := c.Claim(ctx, "unknown"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("claim unknown: %v", err)
	}
	if p, err := c.Claim(ctx, "known"); err != nil || len(p.Accounts) != 2 {
		t.Fatalf("claim: %v", err)
	}
	ci, err := c.Core(ctx, "windows", "amd64")
	if err != nil || ci.FullVersion() != "1.14.2-relayops.6" || ci.URL != srv.URL+"/api/client/core/download/sb.exe" {
		t.Fatalf("core %+v %v", ci, err)
	}
}

// Audit fix: the claim body must carry the same never-empty device name as the
// headers (the panel rejects an empty deviceName with 400 → link stays compat).
func TestClaimSendsNonEmptyDeviceName(t *testing.T) {
	if got := (Device{Name: " 	"}).DisplayName(); got != "Windows PC" {
		t.Fatalf("empty name → %q", got)
	}
	if got := (Device{Name: "PC-1"}).DisplayName(); got != "PC-1" {
		t.Fatalf("control chars kept: %q", got)
	}
	s := newSigner(t)
	var gotName string
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/devices/claim", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		gotName = in["deviceName"]
		s.write(w, SigTypeProfile, []byte(profileJSON))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	c.dev = Device{ID: strings.Repeat("a", 64), Name: "", OS: "windows 10.0.26100"}
	if _, err := c.Claim(context.Background(), "known"); err != nil {
		t.Fatal(err)
	}
	if gotName != "Windows PC" {
		t.Fatalf("claim deviceName = %q", gotName)
	}
}

// Audit fix: an unreachable panel must not make every third-party
// subscription refresh / pasted link wait for the endpoints request again.
func TestEndpointsFailureBacksOff(t *testing.T) {
	s := newSigner(t)
	var hits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/endpoints", func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusBadGateway)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	now := time.Now()
	c.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if _, err := c.Endpoints(context.Background()); err == nil {
			t.Fatal("endpoints should fail")
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("failed fetch retried immediately: %d requests", hits.Load())
	}
	if c.IsPowerVPNURL(context.Background(), "https://sub.example.org/x") {
		t.Fatal("third-party URL counted as POWER云")
	}
	now = now.Add(endpointsRetryAfter + time.Second)
	_, _ = c.Endpoints(context.Background())
	if hits.Load() != 2 {
		t.Fatalf("not retried after the back-off: %d", hits.Load())
	}
}

func sha256sum(v string) string {
	sum := sha256.Sum256([]byte(v))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// EndpointsBody builds a hashed endpoints document (test helper).
func EndpointsBody(salt string, hosts ...string) []byte {
	hashes := make([]string, len(hosts))
	for i, h := range hosts {
		hashes[i] = HostHash(salt, h)
	}
	raw, _ := json.Marshal(map[string]any{"version": 1, "issuedAt": "2026-09-29T00:00:00Z", "salt": salt, "hostHashes": hashes})
	return raw
}

func TestHostHashMatchesContract(t *testing.T) {
	// hex(sha256(salt + "\n" + lowercase(host))), IPv6 brackets stripped.
	sum := sha256.Sum256([]byte("s\n2001:db8::1"))
	if got := HostHash("s", "[2001:DB8::1]"); got != hex.EncodeToString(sum[:]) {
		t.Fatalf("hash %s", got)
	}
}

func TestEndpointsCachePoisoningAndExpiry(t *testing.T) {
	s := newSigner(t)
	up := atomic.Bool{}
	up.Store(true)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/endpoints", func(w http.ResponseWriter, r *http.Request) {
		if !up.Load() {
			w.WriteHeader(502)
			return
		}
		s.write(w, SigTypeEndpoints, EndpointsBody("salt", "tw.example.net"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	ctx := context.Background()
	if _, err := c.Endpoints(ctx); err != nil {
		t.Fatal(err)
	}
	// A forged cache (attacker-written hosts, future timestamp) is rejected on load.
	forged, _ := json.Marshal(endpointsCache{Body: string(EndpointsBody("salt", "evil.example")), Signature: "AAAA", FetchedAt: time.Now().Add(24 * time.Hour)})
	if err := os.WriteFile(filepath.Join(c.dataDir, endpointsFile), forged, 0o600); err != nil {
		t.Fatal(err)
	}
	up.Store(false)
	if eps, err := c.Endpoints(ctx); err == nil && eps.Match("evil.example") {
		t.Fatal("forged endpoints cache accepted")
	}
	// A valid but stale cache is used while the panel is down, until max staleness.
	// (The failed fetch above backs off for endpointsRetryAfter; step past it.)
	up.Store(true)
	c.now = func() time.Time { return time.Now().Add(endpointsRetryAfter + time.Second) }
	if _, err := c.Endpoints(ctx); err != nil {
		t.Fatal(err)
	}
	up.Store(false)
	c.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if eps, err := c.Endpoints(ctx); err != nil || !eps.Match("tw.example.net") {
		t.Fatalf("stale fallback: %v", err)
	}
	c.now = func() time.Time { return time.Now().Add(endpointsMaxStale + time.Hour) }
	if _, err := c.Endpoints(ctx); err == nil {
		t.Fatal("expired cache used")
	}
}

func TestIsPowerVPNURL(t *testing.T) {
	s := newSigner(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/client/endpoints", func(w http.ResponseWriter, r *http.Request) {
		s.write(w, SigTypeEndpoints, EndpointsBody("salt", "tw.example.net"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	ctx := context.Background()
	for u, want := range map[string]bool{
		"https://lxc.5fskins.com/api/sub/tok":  true,
		"https://LXC.5fskins.com./api/sub/tok": true,
		srv.URL + "/api/sub/tok":               true,
		"https://tw.example.net:8443/sub":      true,
		"https://airport.example.com/sub?x=1":  false,
		"https://lxc.5fskins.com.evil.io/sub":  false,
		"not a url":                            false,
	} {
		if got := c.IsPowerVPNURL(ctx, u); got != want {
			t.Errorf("%s: got %v want %v", u, got, want)
		}
	}
}

func TestConcurrentRefreshRotatesOnce(t *testing.T) {
	s := newSigner(t)
	var refreshes atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		var f map[string]string
		_ = json.NewDecoder(r.Body).Decode(&f)
		if f["refresh_token"] != "rt1" {
			w.WriteHeader(400) // reuse of a rotated refresh token
			return
		}
		refreshes.Add(1)
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`{"access_token":"at2","refresh_token":"rt2","expires_in":3600}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	_ = c.setToken(&Token{AccessToken: "at1", RefreshToken: "rt1", ExpiresAt: time.Now()})
	errs := make(chan error, 10)
	for i := 0; i < 10; i++ {
		go func() {
			at, err := c.AccessToken(context.Background())
			if err == nil && at != "at2" {
				err = errors.New("got " + at)
			}
			errs <- err
		}()
	}
	for i := 0; i < 10; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if refreshes.Load() != 1 || !c.LoggedIn() {
		t.Fatalf("refreshes=%d loggedIn=%v", refreshes.Load(), c.LoggedIn())
	}
}

// Audit fix: official node IDs come from the panel's stable node key, so the
// panel reordering / adding nodes (tags carry the position: "节点 1 · 台湾")
// does not move the user's selection to another node.
func TestOfficialNodeIDsFollowStableKey(t *testing.T) {
	profile := func(nodesJSON, outboundsJSON string) *Profile {
		var p Profile
		body := `{"version":1,"accounts":[{"id":"acc1","name":"A","device":{"status":"active"},"outbounds":[` + outboundsJSON + `],"nodes":[` + nodesJSON + `]}]}`
		if err := json.Unmarshal([]byte(body), &p); err != nil {
			t.Fatal(err)
		}
		return &p
	}
	ob := func(tag, server string) string {
		return `{"tag":"` + tag + `","type":"vless","server":"` + server + `","server_port":443,"uuid":"u"}`
	}
	auto := func(members ...string) string {
		return `{"tag":"自动选择","type":"urltest","outbounds":["` + strings.Join(members, `","`) + `"]}`
	}
	ids := func(p *Profile) map[string]string { // key → id
		list, _ := p.Nodes()
		out := map[string]string{}
		for _, n := range list {
			out[strings.TrimPrefix(n.OfficialKey, "acc1/")] = n.ID
		}
		return out
	}
	before := ids(profile(
		`{"tag":"自动选择","outbound":"自动选择","key":"auto"},{"tag":"节点 1 · 台湾","outbound":"节点 1 · 台湾","key":"relay:tw"},{"tag":"节点 2 · 美国","outbound":"节点 2 · 美国","key":"landing:us"}`,
		ob("节点 1 · 台湾", "tw.example")+","+ob("节点 2 · 美国", "us.example")+","+auto("节点 1 · 台湾", "节点 2 · 美国")))
	// A new node goes first: every tag shifts, the keys don't.
	after := ids(profile(
		`{"tag":"自动选择","outbound":"自动选择","key":"auto"},{"tag":"节点 1 · 日本","outbound":"节点 1 · 日本","key":"relay:jp"},{"tag":"节点 2 · 台湾","outbound":"节点 2 · 台湾","key":"relay:tw"},{"tag":"节点 3 · 美国","outbound":"节点 3 · 美国","key":"landing:us"}`,
		ob("节点 1 · 日本", "jp.example")+","+ob("节点 2 · 台湾", "tw.example")+","+ob("节点 3 · 美国", "us.example")+","+auto("节点 1 · 日本", "节点 2 · 台湾", "节点 3 · 美国")))
	for _, k := range []string{"auto", "relay:tw", "landing:us"} {
		if before[k] == "" || before[k] != after[k] {
			t.Fatalf("%s: id %q → %q", k, before[k], after[k])
		}
	}
	if after["relay:jp"] == "" || after["relay:jp"] == after["relay:tw"] {
		t.Fatalf("ids not distinct: %v", after)
	}
	// Older panels (no key): the tag-based ID as before, no OfficialKey.
	old := profile(`{"tag":"节点 1 · 台湾","outbound":"节点 1 · 台湾"}`, ob("节点 1 · 台湾", "tw.example"))
	list, _ := old.Nodes()
	if len(list) != 1 || list[0].ID != officialID("acc1", "节点 1 · 台湾") || list[0].OfficialKey != "" {
		t.Fatalf("fallback changed: %+v", list[0])
	}
}

func TestLoginWithTicket(t *testing.T) {
	s := newSigner(t)
	var used atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		var f map[string]string
		_ = json.NewDecoder(r.Body).Decode(&f)
		if f["grant_type"] != TicketGrant || f["ticket"] != "good-ticket" || f["client_id"] != ClientID || used.Add(1) > 1 {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"下载凭据无效、已过期或已使用"}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"at1","refresh_token":"rt1","token_type":"Bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/api/client/me", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"u1","username":"ai0782","email":null,"displayName":"ai0782"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := testClient(t, srv, s)
	if err := c.LoginWithTicket(context.Background(), "good-ticket"); err != nil {
		t.Fatal(err)
	}
	if !c.LoggedIn() || c.Username() != "ai0782" {
		t.Fatalf("login state: %v %q", c.LoggedIn(), c.Username())
	}
	c2 := testClient(t, srv, s)
	if err := c2.LoginWithTicket(context.Background(), "good-ticket"); !errors.Is(err, ErrTicketRejected) || c2.LoggedIn() {
		t.Fatalf("second use must be rejected: %v loggedIn=%v", err, c2.LoggedIn())
	}
}
