package license

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// These values are injected by the commercial release pipeline. Keeping them
// empty produces a non-commercial development build and never locks existing
// users out while the licensing service is being deployed.
var APIURL string
var PublicKeyBase64 string
var TLSSPKISHA256 string

type Status struct {
	Enabled       bool     `json:"enabled"`
	Authenticated bool     `json:"authenticated"`
	Username      string   `json:"username"`
	Plan          string   `json:"plan"`
	Features      []string `json:"features"`
	ExpiresAt     string   `json:"expiresAt"`
	OfflineUntil  string   `json:"offlineUntil"`
	Error         string   `json:"error,omitempty"`
}

type state struct {
	Username     string   `json:"username"`
	RefreshToken string   `json:"refreshToken"`
	AccessToken  string   `json:"accessToken"`
	Lease        string   `json:"lease"`
	Plan         string   `json:"plan"`
	Features     []string `json:"features"`
}

type leaseClaims struct {
	Subject    string   `json:"sub"`
	DeviceID   string   `json:"did"`
	Plan       string   `json:"plan"`
	Features   []string `json:"features"`
	MinVersion string   `json:"minVersion"`
	Expires    int64    `json:"exp"`
	GraceHours int      `json:"grace"`
}

type Client struct {
	mu          sync.Mutex
	path        string
	version     string
	apiURL      string
	fingerprint string
	deviceName  string
	http        *http.Client
	publicKey   ed25519.PublicKey
	state       state
}

func New(dataDir, version string) *Client {
	host, _ := os.Hostname()
	machine := machineID()
	if machine == "" {
		machine = host
	}
	sum := sha256.Sum256([]byte("ProxySplit-Device-v1\x00" + machine))
	c := &Client{
		path:        filepath.Join(dataDir, "license.dat"),
		version:     version,
		apiURL:      strings.TrimRight(APIURL, "/"),
		fingerprint: hex.EncodeToString(sum[:]),
		deviceName:  host,
		http:        &http.Client{Timeout: 12 * time.Second, Transport: pinnedTransport()},
	}
	c.publicKey = parsePublicKey(PublicKeyBase64)
	c.load()
	return c
}

func pinnedTransport() http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if TLSSPKISHA256 == "" {
		return transport
	}
	pin := strings.ToLower(strings.TrimSpace(TLSSPKISHA256))
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, VerifyConnection: func(cs tls.ConnectionState) error {
		if len(cs.PeerCertificates) == 0 {
			return errors.New("server certificate missing")
		}
		sum := sha256.Sum256(cs.PeerCertificates[0].RawSubjectPublicKeyInfo)
		if hex.EncodeToString(sum[:]) != pin && base64.StdEncoding.EncodeToString(sum[:]) != TLSSPKISHA256 {
			return errors.New("server certificate pin mismatch")
		}
		return nil
	}}
	return transport
}

func parsePublicKey(encoded string) ed25519.PublicKey {
	der, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(der) == 0 {
		return nil
	}
	parsed, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil
	}
	key, _ := parsed.(ed25519.PublicKey)
	return key
}

func (c *Client) Enabled() bool { return c.apiURL != "" }

func (c *Client) load() {
	raw, err := os.ReadFile(c.path)
	if err != nil {
		return
	}
	plain, err := unprotect(raw)
	if err == nil {
		_ = json.Unmarshal(plain, &c.state)
	}
}

func (c *Client) saveLocked() error {
	raw, err := json.Marshal(c.state)
	if err != nil {
		return err
	}
	sealed, err := protect(raw)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}

func (c *Client) request(ctx context.Context, method, path string, input any, output any, token string) error {
	if c.apiURL == "" {
		return errors.New("商业服务地址未配置")
	}
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.apiURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var envelope struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &envelope)
		if envelope.Error.Message != "" {
			return errors.New(envelope.Error.Message)
		}
		return fmt.Errorf("授权服务返回 HTTP %d", resp.StatusCode)
	}
	if output != nil {
		return json.Unmarshal(raw, output)
	}
	return nil
}

func (c *Client) Login(username, password string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		License      struct {
			Plan     string   `json:"plan"`
			Features []string `json:"features"`
		} `json:"license"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := c.request(ctx, http.MethodPost, "/v1/auth/login", map[string]any{
		"username": username, "password": password,
		"device": map[string]any{"fingerprint": c.fingerprint, "name": c.deviceName, "platform": "windows", "appVersion": normalizedVersion(c.version)},
	}, &result, "")
	if err != nil {
		return err
	}
	c.state = state{Username: strings.TrimSpace(username), AccessToken: result.AccessToken, RefreshToken: result.RefreshToken, Plan: result.License.Plan, Features: result.License.Features}
	if err := c.acquireLeaseLocked(ctx); err != nil {
		c.state = state{}
		return err
	}
	return c.saveLocked()
}

func normalizedVersion(v string) string {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	parts := strings.Split(v, ".")
	if len(parts) < 3 {
		return "0.0.0"
	}
	for i := 0; i < 3; i++ {
		if _, err := strconv.Atoi(strings.SplitN(parts[i], "-", 2)[0]); err != nil {
			return "0.0.0"
		}
	}
	return v
}

func (c *Client) refreshLocked(ctx context.Context) error {
	if c.state.RefreshToken == "" {
		return errors.New("请先登录")
	}
	var result struct{ AccessToken, RefreshToken string }
	if err := c.request(ctx, http.MethodPost, "/v1/auth/refresh", map[string]any{"refreshToken": c.state.RefreshToken, "deviceFingerprint": c.fingerprint}, &result, ""); err != nil {
		return err
	}
	c.state.AccessToken, c.state.RefreshToken = result.AccessToken, result.RefreshToken
	return nil
}

func (c *Client) acquireLeaseLocked(ctx context.Context) error {
	var result struct {
		Lease string `json:"lease"`
	}
	if err := c.request(ctx, http.MethodPost, "/v1/license/lease", map[string]any{"deviceFingerprint": c.fingerprint, "appVersion": normalizedVersion(c.version)}, &result, c.state.AccessToken); err != nil {
		if err := c.refreshLocked(ctx); err != nil {
			return err
		}
		if err := c.request(ctx, http.MethodPost, "/v1/license/lease", map[string]any{"deviceFingerprint": c.fingerprint, "appVersion": normalizedVersion(c.version)}, &result, c.state.AccessToken); err != nil {
			return err
		}
	}
	claims, err := c.verifyLease(result.Lease)
	if err != nil {
		return err
	}
	c.state.Lease, c.state.Plan, c.state.Features = result.Lease, claims.Plan, claims.Features
	return nil
}

func (c *Client) verifyLease(token string) (leaseClaims, error) {
	var claims leaseClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(c.publicKey) != ed25519.PublicKeySize {
		return claims, errors.New("授权签名公钥未配置或租约格式无效")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !ed25519.Verify(c.publicKey, []byte(parts[0]+"."+parts[1]), sig) {
		return claims, errors.New("授权租约签名无效")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return claims, errors.New("授权租约内容无效")
	}
	if claims.Subject == "" || claims.DeviceID == "" || claims.Expires == 0 || claims.GraceHours < 0 || claims.GraceHours > 72 {
		return claims, errors.New("授权租约期限无效")
	}
	if compareVersion(normalizedVersion(c.version), claims.MinVersion) < 0 {
		return claims, errors.New("当前客户端版本过低，请先升级")
	}
	return claims, nil
}

func compareVersion(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		var ai, bi int
		if i < len(pa) {
			ai, _ = strconv.Atoi(strings.SplitN(pa[i], "-", 2)[0])
		}
		if i < len(pb) {
			bi, _ = strconv.Atoi(strings.SplitN(pb[i], "-", 2)[0])
		}
		if ai < bi {
			return -1
		}
		if ai > bi {
			return 1
		}
	}
	return 0
}

func (c *Client) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	status := Status{Enabled: c.Enabled(), Username: c.state.Username, Plan: c.state.Plan, Features: append([]string{}, c.state.Features...)}
	if !status.Enabled {
		status.Authenticated = true
		return status
	}
	claims, err := c.verifyLease(c.state.Lease)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.Plan = claims.Plan
	status.Features = append([]string{}, claims.Features...)
	expires := time.Unix(claims.Expires, 0)
	offlineUntil := expires.Add(time.Duration(claims.GraceHours) * time.Hour)
	status.ExpiresAt, status.OfflineUntil = expires.Format(time.RFC3339), offlineUntil.Format(time.RFC3339)
	status.Authenticated = time.Now().Before(offlineUntil)
	if !status.Authenticated {
		status.Error = "授权已过期，请联网重新登录"
	}
	return status
}

func (c *Client) EnsureEntitled() error {
	if !c.Enabled() {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if c.state.RefreshToken != "" {
		if c.refreshLocked(ctx) == nil && c.acquireLeaseLocked(ctx) == nil {
			_ = c.saveLocked()
			return nil
		}
	}
	claims, err := c.verifyLease(c.state.Lease)
	if err != nil {
		return err
	}
	if time.Now().After(time.Unix(claims.Expires, 0).Add(time.Duration(claims.GraceHours) * time.Hour)) {
		return errors.New("授权已过期，请联网重新登录")
	}
	return nil
}

func (c *Client) Logout() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Enabled() && c.state.RefreshToken != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		// Logout is deliberately best-effort: local credentials must be removed
		// even when the service is temporarily unreachable.
		_ = c.request(ctx, http.MethodPost, "/v1/auth/logout", map[string]any{"refreshToken": c.state.RefreshToken, "deviceFingerprint": c.fingerprint}, nil, "")
	}
	c.state = state{}
	if err := os.Remove(c.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (c *Client) APIOrigin() string {
	u, err := url.Parse(c.apiURL)
	if err != nil {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
