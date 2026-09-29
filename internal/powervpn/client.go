package powervpn

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/license"
)

// DefaultBaseURL is the POWER云 panel (overridable with -ldflags -X).
var DefaultBaseURL = "https://lxc.5fskins.com"

const (
	// ClientID is the panel's public OAuth client for ProxySplit.
	ClientID = "proxysplit"
	// ProfileSubURL is the pseudo subscription address of the logged-in
	// POWER云 account; the service fetches it through Client.Profile.
	ProfileSubURL = "powervpn://profile"

	maxBody           = 8 << 20
	endpointsTTL      = time.Hour
	endpointsMaxStale = 7 * 24 * time.Hour
	// endpointsRetryAfter: after a failed endpoints fetch, don't ask the panel
	// again for a while. Every third-party subscription refresh and every
	// pasted link checks the endpoints; with the panel unreachable (blackholed)
	// each of them would otherwise wait for the full request timeout.
	endpointsRetryAfter = 5 * time.Minute
	tokenFile           = "powervpn.dat"
	endpointsFile       = "powervpn-endpoints.json"
	refreshLeeway       = 60 * time.Second
	defaultReqTimeout   = 20 * time.Second
)

var (
	// ErrNotLoggedIn: no POWER云 account on this device.
	ErrNotLoggedIn = errors.New("尚未登录 POWER云 账号")
	// ErrNotFound: the panel does not know the UUID (claim) — keep compat mode.
	ErrNotFound = errors.New("POWER云 未找到该账号")
	// errGrantRejected: the refresh token was refused (revoked / expired).
	errGrantRejected = errors.New("POWER云 授权无效或已过期，请重新登录")
	// errEndpointsBackoff: the last endpoints fetch failed moments ago.
	errEndpointsBackoff = errors.New("POWER云 入口列表暂不可用，稍后重试")
)

// Token is the stored OAuth grant.
type Token struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Username     string    `json:"username,omitempty"`
}

// Options configures a Client (tests inject everything).
type Options struct {
	BaseURL  string
	DataDir  string
	Version  string // ProxySplit version for the User-Agent
	HTTP     *http.Client
	Verifier Verifier
	Device   *Device
	// Seal/Open protect the token file (default: DPAPI like license.dat).
	Seal, Open func([]byte) ([]byte, error)
	Now        func() time.Time
}

// Client is safe for concurrent use.
type Client struct {
	base     string
	dataDir  string
	version  string
	http     *http.Client
	verifier Verifier
	seal     func([]byte) ([]byte, error)
	open     func([]byte) ([]byte, error)
	now      func() time.Time

	devOnce sync.Once
	dev     Device
	devSet  bool

	mu         sync.Mutex
	tok        *Token
	refreshing sync.Mutex

	epMu      sync.Mutex
	epRetryAt time.Time // no endpoints fetch before this (after a failure)
}

// New creates the production client.
func New(dataDir, version string) *Client {
	return NewWith(Options{DataDir: dataDir, Version: version})
}

// NewWith creates a client from explicit options.
func NewWith(o Options) *Client {
	c := &Client{
		base: strings.TrimRight(firstNonEmpty(o.BaseURL, DefaultBaseURL), "/"), dataDir: o.DataDir, version: o.Version,
		http: o.HTTP, verifier: o.Verifier, seal: o.Seal, open: o.Open, now: o.Now,
	}
	if c.http == nil {
		c.http = &http.Client{Timeout: defaultReqTimeout}
	}
	if c.verifier == nil {
		c.verifier = DefaultVerifier()
	}
	if c.seal == nil {
		c.seal = license.Protect
	}
	if c.open == nil {
		c.open = license.Unprotect
	}
	if c.now == nil {
		c.now = time.Now
	}
	if o.Device != nil {
		c.dev, c.devSet = *o.Device, true
	}
	c.load()
	return c
}

// BaseURL returns the panel address.
func (c *Client) BaseURL() string { return c.base }

// Verifier returns the signature verifier in use.
func (c *Client) Verifier() Verifier { return c.verifier }

// Device returns this installation's identity (computed once, lazily: the
// machine ID query may take a few seconds on Windows).
func (c *Client) Device() Device {
	c.devOnce.Do(func() {
		if !c.devSet {
			c.dev = CurrentDevice()
		}
	})
	return c.dev
}

// UserAgent is "ProxySplit/<version>" (design §2.1).
func (c *Client) UserAgent() string {
	v := strings.TrimPrefix(strings.TrimSpace(c.version), "v")
	if v == "" {
		v = "dev"
	}
	return "ProxySplit/" + v
}

// ClientHeaders returns User-Agent + device headers for panel requests.
func (c *Client) ClientHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", c.UserAgent())
	c.Device().Apply(h)
	return h
}

// ---- token storage ----

func (c *Client) tokenPath() string { return filepath.Join(c.dataDir, tokenFile) }

func (c *Client) load() {
	if c.dataDir == "" {
		return
	}
	raw, err := os.ReadFile(c.tokenPath())
	if err != nil {
		return
	}
	plain, err := c.open(raw)
	if err != nil {
		return
	}
	var t Token
	if json.Unmarshal(plain, &t) == nil && t.RefreshToken != "" {
		c.tok = &t
	}
}

func (c *Client) saveLocked() error {
	if c.dataDir == "" {
		return nil
	}
	if c.tok == nil {
		err := os.Remove(c.tokenPath())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	raw, err := json.Marshal(c.tok)
	if err != nil {
		return err
	}
	sealed, err := c.seal(raw)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(c.dataDir, 0o700); err != nil {
		return err
	}
	tmp := c.tokenPath() + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.tokenPath())
}

// LoggedIn reports whether a POWER云 grant is stored.
func (c *Client) LoggedIn() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tok != nil
}

// Username of the logged-in POWER云 account (may be empty).
func (c *Client) Username() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tok == nil {
		return ""
	}
	return c.tok.Username
}

// SetUsername records the display name after login.
func (c *Client) SetUsername(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tok != nil {
		c.tok.Username = name
		_ = c.saveLocked()
	}
}

// Logout forgets the stored grant (the panel-side grant can be revoked in the
// customer portal).
func (c *Client) Logout() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tok = nil
	return c.saveLocked()
}

func (c *Client) setToken(t *Token) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tok != nil && t.Username == "" {
		t.Username = c.tok.Username
	}
	c.tok = t
	return c.saveLocked()
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (c *Client) tokenRequest(ctx context.Context, form map[string]string) (*Token, error) {
	form["client_id"] = ClientID
	var out tokenResponse
	status, err := c.doJSON(ctx, http.MethodPost, "/api/oauth/token", form, "", &out)
	if err != nil {
		if status == http.StatusBadRequest || status == http.StatusUnauthorized {
			return nil, errGrantRejected
		}
		return nil, err
	}
	if out.AccessToken == "" || out.RefreshToken == "" {
		return nil, fmt.Errorf("POWER云 返回的令牌无效")
	}
	exp := out.ExpiresIn
	if exp <= 0 {
		exp = 3600
	}
	return &Token{AccessToken: out.AccessToken, RefreshToken: out.RefreshToken, ExpiresAt: c.now().Add(time.Duration(exp) * time.Second)}, nil
}

// AccessToken returns a valid access token, refreshing (with rotation) when it
// is about to expire.
func (c *Client) AccessToken(ctx context.Context) (string, error) {
	_, at, err := c.accessToken(ctx)
	return at, err
}

// accessToken also returns the grant the access token belongs to, so a 401
// retry refreshes exactly that grant (not one rotated meanwhile).
func (c *Client) accessToken(ctx context.Context) (*Token, string, error) {
	c.mu.Lock()
	tok := c.tok
	c.mu.Unlock()
	if tok == nil {
		return nil, "", ErrNotLoggedIn
	}
	if tok.AccessToken != "" && c.now().Add(refreshLeeway).Before(tok.ExpiresAt) {
		return tok, tok.AccessToken, nil
	}
	at, err := c.forceRefresh(ctx, tok)
	if err != nil {
		return nil, "", err
	}
	c.mu.Lock()
	cur := c.tok
	c.mu.Unlock()
	return cur, at, nil
}

// forceRefresh rotates the refresh token once even if several callers race.
func (c *Client) forceRefresh(ctx context.Context, stale *Token) (string, error) {
	c.refreshing.Lock()
	defer c.refreshing.Unlock()
	c.mu.Lock()
	cur := c.tok
	c.mu.Unlock()
	if cur == nil {
		return "", ErrNotLoggedIn
	}
	if cur != stale && cur.AccessToken != "" && c.now().Add(refreshLeeway).Before(cur.ExpiresAt) {
		return cur.AccessToken, nil // someone else refreshed (or logged in) meanwhile
	}
	t, err := c.tokenRequest(ctx, map[string]string{"grant_type": "refresh_token", "refresh_token": cur.RefreshToken})
	if err != nil {
		if errors.Is(err, errGrantRejected) {
			// Revoked in the portal / expired: forget it, user must log in again
			// (only if it is still the grant we tried — not a fresh login).
			c.mu.Lock()
			if c.tok == cur {
				c.tok = nil
				_ = c.saveLocked()
			}
			c.mu.Unlock()
		}
		return "", err
	}
	if err := c.setToken(t); err != nil {
		return "", err
	}
	return t.AccessToken, nil
}

// ---- HTTP helpers ----

// StatusError is a non-2xx panel response.
type StatusError struct {
	Status  int
	Message string
}

func (e *StatusError) Error() string { return e.Message }

// do performs a request and returns status, headers and the (bounded) body.
// Tokens only ever travel in the Authorization header and are never logged.
func (c *Client) do(ctx context.Context, method, path string, body any, bearer string) (int, http.Header, []byte, error) {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, nil, err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return 0, nil, nil, err
	}
	for k, v := range c.ClientHeaders() {
		req.Header[k] = v
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err // drop the URL (may carry query parameters)
		}
		return 0, nil, nil, fmt.Errorf("连接 POWER云 失败：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return resp.StatusCode, resp.Header, nil, err
	}
	if len(raw) > maxBody {
		return resp.StatusCode, resp.Header, nil, fmt.Errorf("POWER云 响应过大")
	}
	return resp.StatusCode, resp.Header, raw, nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, bearer string, out any) (int, error) {
	status, _, raw, err := c.do(ctx, method, path, body, bearer)
	if err != nil {
		return status, err
	}
	if status < 200 || status > 299 {
		return status, &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return status, fmt.Errorf("POWER云 响应无法解析：%w", err)
		}
	}
	return status, nil
}

func panelMessage(status int, raw []byte) string {
	var e struct {
		Message     string `json:"message"`
		Description string `json:"error_description"` // OAuth error body
		Error       any    `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil {
		if e.Description != "" {
			return e.Description
		}
		if e.Message != "" {
			return e.Message
		}
		switch v := e.Error.(type) {
		case string:
			if v != "" {
				return v
			}
		case map[string]any:
			if m, _ := v["message"].(string); m != "" {
				return m
			}
		}
	}
	return fmt.Sprintf("POWER云 请求失败（HTTP %d）", status)
}

// authed runs an authenticated request, refreshing once on 401.
func (c *Client) authed(ctx context.Context, method, path string, body any) (int, http.Header, []byte, error) {
	stale, tok, err := c.accessToken(ctx)
	if err != nil {
		return 0, nil, nil, err
	}
	status, h, raw, err := c.do(ctx, method, path, body, tok)
	if err == nil && status == http.StatusUnauthorized {
		if tok, err = c.forceRefresh(ctx, stale); err != nil {
			return 0, nil, nil, err
		}
		status, h, raw, err = c.do(ctx, method, path, body, tok)
	}
	return status, h, raw, err
}

// Me is GET /api/client/me.
type Me struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

// Me returns the logged-in panel account.
func (c *Client) Me(ctx context.Context) (*Me, error) {
	status, _, raw, err := c.authed(ctx, http.MethodGet, "/api/client/me", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	var me Me
	if err := json.Unmarshal(raw, &me); err != nil {
		return nil, err
	}
	return &me, nil
}

// Profile fetches GET /api/client/profile (signed "profile").
func (c *Client) Profile(ctx context.Context) (*Profile, error) {
	status, h, raw, err := c.authed(ctx, http.MethodGet, "/api/client/profile", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	return ParseSignedProfile(c.verifier, h, raw)
}

// Claim registers this device for a pasted link's account UUID
// (POST /api/client/devices/claim). ErrNotFound → keep the link as-is.
func (c *Client) Claim(ctx context.Context, uuid string) (*Profile, error) {
	d := c.Device()
	status, h, raw, err := c.do(ctx, http.MethodPost, "/api/client/devices/claim", map[string]string{
		"uuid": uuid, "deviceId": d.ID, "deviceName": d.DisplayName(), "os": d.OS,
	}, "")
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if status != http.StatusOK {
		return nil, &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	return ParseSignedProfile(c.verifier, h, raw)
}

// ---- endpoints (cached 1h, persisted) ----

// endpointsDoc is the signed entry-host list. Hosts are not published in the
// clear: hostHashes[i] = hex(sha256(salt + "\n" + lowercase(host))).
type endpointsDoc struct {
	Version    int      `json:"version"`
	IssuedAt   string   `json:"issuedAt"`
	Salt       string   `json:"salt"`
	HostHashes []string `json:"hostHashes"`
}

// Endpoints is the verified set of POWER云 entry hosts (hashed).
type Endpoints struct {
	salt   string
	hashes map[string]bool
}

func newEndpoints(doc endpointsDoc) (*Endpoints, error) {
	if doc.Version != 1 || doc.Salt == "" {
		return nil, fmt.Errorf("POWER云 入口列表格式不受支持")
	}
	e := &Endpoints{salt: doc.Salt, hashes: make(map[string]bool, len(doc.HostHashes))}
	for _, h := range doc.HostHashes {
		e.hashes[strings.ToLower(strings.TrimSpace(h))] = true
	}
	return e, nil
}

// HostHash is the endpoints hash of one host (brackets stripped, lowercased).
func HostHash(salt, host string) string {
	sum := sha256.Sum256([]byte(salt + "\n" + strings.ToLower(stripBrackets(host))))
	return hex.EncodeToString(sum[:])
}

// Match reports whether host is one of the entry hosts. Besides the literal
// (lowercased) form it tries the canonical IP / no-trailing-dot spelling so
// "2001:DB8::1" and "[2001:db8:0::1]" match the same entry.
func (e *Endpoints) Match(host string) bool {
	if e == nil || len(e.hashes) == 0 {
		return false
	}
	for _, v := range hostVariants(host) {
		if e.hashes[HostHash(e.salt, v)] {
			return true
		}
	}
	return false
}

// Len is the number of entry hosts.
func (e *Endpoints) Len() int {
	if e == nil {
		return 0
	}
	return len(e.hashes)
}

func stripBrackets(h string) string {
	h = strings.TrimSpace(h)
	if strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]") {
		h = h[1 : len(h)-1]
	}
	return h
}

func hostVariants(host string) []string {
	h := strings.ToLower(stripBrackets(host))
	if h == "" {
		return nil
	}
	out := []string{h}
	add := func(v string) {
		for _, o := range out {
			if o == v {
				return
			}
		}
		out = append(out, v)
	}
	if ip := net.ParseIP(h); ip != nil {
		add(ip.String())
	} else if t := strings.TrimSuffix(h, "."); t != "" {
		add(t)
	}
	return out
}

// PanelHost is the production POWER云 panel host; it is always recognised as
// POWER云 even when the client is built with another base URL.
const PanelHost = "lxc.5fskins.com"

// IsPowerVPNURL reports whether rawURL points at POWER云: the panel host (the
// production one or the configured base) or a host in the signature-verified
// endpoints list. Only such URLs may receive the device headers and the
// "ProxySplit/" User-Agent (design §2.2); anything else — including when the
// endpoints list cannot be loaded — is a third-party address.
func (c *Client) IsPowerVPNURL(ctx context.Context, rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Hostname() == "" {
		return false
	}
	host := u.Hostname()
	if sameHost(host, PanelHost) {
		return true
	}
	// The configured base counts with its port (a dev panel on 127.0.0.1:8080
	// must not make every local subscription "POWER云").
	if b, err := url.Parse(c.base); err == nil && b.Hostname() != "" && sameHost(host, b.Hostname()) && effectivePort(u) == effectivePort(b) {
		return true
	}
	eps, err := c.Endpoints(ctx)
	return err == nil && eps.Match(host)
}

type endpointsCache struct {
	Body      string    `json:"body"`
	Signature string    `json:"signature"`
	FetchedAt time.Time `json:"fetchedAt"`
}

func parseEndpoints(body []byte) (*Endpoints, error) {
	var doc endpointsDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	return newEndpoints(doc)
}

func (c *Client) readEndpointsCache() (*endpointsCache, *Endpoints) {
	if c.dataDir == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(filepath.Join(c.dataDir, endpointsFile))
	if err != nil {
		return nil, nil
	}
	var ec endpointsCache
	if json.Unmarshal(raw, &ec) != nil {
		return nil, nil
	}
	// Re-verify on load: the cache file is not trusted by itself.
	if c.verifier.Verify(SigTypeEndpoints, []byte(ec.Body), ec.Signature) != nil {
		return nil, nil
	}
	e, err := parseEndpoints([]byte(ec.Body))
	if err != nil {
		return nil, nil
	}
	// FetchedAt is not signed: never trust a future timestamp (it would pin
	// an old list forever).
	if ec.FetchedAt.After(c.now()) {
		ec.FetchedAt = time.Time{}
	}
	return &ec, e
}

// Endpoints returns the panel's entry hosts (GET /api/client/endpoints),
// served from a verified 1-hour cache; a stale cache is used (up to
// endpointsMaxStale) if the panel is unreachable.
func (c *Client) Endpoints(ctx context.Context) (*Endpoints, error) {
	ec, cached := c.readEndpointsCache()
	if ec != nil && c.now().Sub(ec.FetchedAt) < endpointsTTL {
		return cached, nil
	}
	c.epMu.Lock()
	backoff := c.now().Before(c.epRetryAt)
	c.epMu.Unlock()
	if backoff {
		if ec != nil && c.now().Sub(ec.FetchedAt) < endpointsMaxStale {
			return cached, nil
		}
		return nil, errEndpointsBackoff
	}
	status, h, raw, err := c.do(ctx, http.MethodGet, "/api/client/endpoints", nil, "")
	if err == nil && status != http.StatusOK {
		err = &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	if err == nil {
		err = VerifyResponse(c.verifier, SigTypeEndpoints, h, raw)
	}
	var e *Endpoints
	if err == nil {
		e, err = parseEndpoints(raw)
	}
	c.epMu.Lock()
	if err != nil {
		c.epRetryAt = c.now().Add(endpointsRetryAfter)
	} else {
		c.epRetryAt = time.Time{}
	}
	c.epMu.Unlock()
	if err != nil {
		if ec != nil && c.now().Sub(ec.FetchedAt) < endpointsMaxStale {
			return cached, nil
		}
		return nil, err
	}
	if c.dataDir != "" {
		cache, _ := json.Marshal(endpointsCache{Body: string(raw), Signature: strings.TrimSpace(h.Get(HeaderSignature)), FetchedAt: c.now()})
		_ = os.MkdirAll(c.dataDir, 0o700)
		tmp := filepath.Join(c.dataDir, endpointsFile+".tmp")
		if os.WriteFile(tmp, cache, 0o600) == nil {
			_ = os.Rename(tmp, filepath.Join(c.dataDir, endpointsFile))
		}
	}
	return e, nil
}

// ---- core ----

// CoreInfo is GET /api/client/core (signed "core").
type CoreInfo struct {
	Version string `json:"version"`
	Build   string `json:"build"`
	SHA256  string `json:"sha256"`
	URL     string `json:"url"`
}

// FullVersion is "<version>-<build>", e.g. "1.14.2-relayops.6".
func (ci CoreInfo) FullVersion() string {
	if ci.Build == "" {
		return ci.Version
	}
	return ci.Version + "-" + ci.Build
}

// Core returns the platform-built sing-box for os/arch, signature-verified;
// URL is resolved against the panel base.
func (c *Client) Core(ctx context.Context, goos, arch string) (*CoreInfo, error) {
	q := url.Values{"os": {goos}, "arch": {arch}}
	status, h, raw, err := c.do(ctx, http.MethodGet, "/api/client/core?"+q.Encode(), nil, "")
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, &StatusError{Status: status, Message: panelMessage(status, raw)}
	}
	if err := VerifyResponse(c.verifier, SigTypeCore, h, raw); err != nil {
		return nil, err
	}
	var ci CoreInfo
	if err := json.Unmarshal(raw, &ci); err != nil {
		return nil, err
	}
	if ci.Version == "" || len(ci.SHA256) != 64 || ci.URL == "" {
		return nil, fmt.Errorf("POWER云 内核信息不完整")
	}
	u, err := url.Parse(ci.URL)
	if err != nil {
		return nil, err
	}
	base, _ := url.Parse(c.base + "/")
	ci.URL = base.ResolveReference(u).String()
	return &ci, nil
}

func effectivePort(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	if strings.EqualFold(u.Scheme, "http") {
		return "80"
	}
	return "443"
}

func sameHost(a, b string) bool {
	va, vb := hostVariants(a), hostVariants(b)
	for _, x := range va {
		for _, y := range vb {
			if x == y {
				return true
			}
		}
	}
	return false
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
