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
	Enabled            bool     `json:"enabled"`
	SignedIn           bool     `json:"signedIn"`
	Authenticated      bool     `json:"authenticated"`
	Username           string   `json:"username"`
	Plan               string   `json:"plan"`
	PlanCode           string   `json:"planCode"`
	Tier               string   `json:"tier"`
	MaxDevices         int      `json:"maxDevices"`
	Features           []string `json:"features"`
	ExpiresAt          string   `json:"expiresAt"`
	OfflineUntil       string   `json:"offlineUntil"`
	DeviceLimitReached bool     `json:"deviceLimitReached"`
	Error              string   `json:"error,omitempty"`
}

type Plan struct {
	ID                 string   `json:"id"`
	Code               string   `json:"code"`
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	Tier               string   `json:"tier"`
	BillingCycle       string   `json:"billingCycle"`
	DurationDays       *int     `json:"durationDays"`
	Lifetime           bool     `json:"lifetime"`
	PriceCents         int      `json:"priceCents"`
	OriginalPriceCents *int     `json:"originalPriceCents"`
	Currency           string   `json:"currency"`
	MaxDevices         int      `json:"maxDevices"`
	Features           []string `json:"features"`
	Badge              string   `json:"badge"`
	SaleEndsAt         string   `json:"saleEndsAt"`
}

type Device struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Platform    string `json:"platform"`
	AppVersion  string `json:"appVersion"`
	FirstSeenAt string `json:"firstSeenAt"`
	LastSeenAt  string `json:"lastSeenAt"`
	Current     bool   `json:"current"`
}

type Order struct {
	OrderNo     string `json:"orderNo"`
	PlanName    string `json:"planName"`
	AmountCents int    `json:"amountCents"`
	Currency    string `json:"currency"`
	Status      string `json:"status"`
	PayURL      string `json:"payUrl"`
	PaidAt      string `json:"paidAt"`
	ExpiresAt   string `json:"expiresAt"`
	CreatedAt   string `json:"createdAt"`
}

type Announcement struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Content     string `json:"content"`
	Version     string `json:"version"`
	Pinned      bool   `json:"pinned"`
	PublishedAt string `json:"publishedAt"`
}

type state struct {
	Username      string   `json:"username"`
	RefreshToken  string   `json:"refreshToken"`
	AccessToken   string   `json:"accessToken"`
	Lease         string   `json:"lease"`
	DeviceID      string   `json:"deviceId"`
	Plan          string   `json:"plan"`
	PlanCode      string   `json:"planCode"`
	Tier          string   `json:"tier"`
	MaxDevices    int      `json:"maxDevices"`
	Features      []string `json:"features"`
	PendingDevice bool     `json:"pendingDevice"`
}

type leaseClaims struct {
	Subject            string   `json:"sub"`
	DeviceID           string   `json:"did"`
	FingerprintHash    string   `json:"fph"`
	Plan               string   `json:"plan"`
	PlanCode           string   `json:"planCode"`
	Tier               string   `json:"tier"`
	MaxDevices         int      `json:"maxDevices"`
	Features           []string `json:"features"`
	MinVersion         string   `json:"minVersion"`
	Expires            int64    `json:"exp"`
	GraceHours         int      `json:"grace"`
	EntitlementExpires int64    `json:"entitlementExp"`
}

type Client struct {
	mu           sync.Mutex
	path         string
	version      string
	apiURL       string
	fingerprint  string
	hardwareHash string
	deviceName   string
	http         *http.Client
	publicKey    ed25519.PublicKey
	state        state
}

type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

func New(dataDir, version string) *Client {
	host, _ := os.Hostname()
	machine := machineID()
	if machine == "" {
		machine = host
	}
	sum := sha256.Sum256([]byte("ProxySplit-Device-v2\x00" + machine))
	hardware := sha256.Sum256([]byte("ProxySplit-Hardware-v2\x00" + machine))
	c := &Client{
		path:         filepath.Join(dataDir, "license.dat"),
		version:      version,
		apiURL:       strings.TrimRight(APIURL, "/"),
		fingerprint:  hex.EncodeToString(sum[:]),
		hardwareHash: hex.EncodeToString(hardware[:]),
		deviceName:   host,
		http:         &http.Client{Timeout: 12 * time.Second, Transport: pinnedTransport()},
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

func (c *Client) HasFeature(name string) bool {
	if !c.Enabled() {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, feature := range c.state.Features {
		if feature == name || feature == "admin" {
			return true
		}
	}
	return false
}

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
			return &APIError{Status: resp.StatusCode, Message: envelope.Error.Message}
		}
		return &APIError{Status: resp.StatusCode, Message: fmt.Sprintf("授权服务返回 HTTP %d", resp.StatusCode)}
	}
	if output != nil {
		return json.Unmarshal(raw, output)
	}
	return nil
}

type authResult struct {
	AccessToken        string `json:"accessToken"`
	RefreshToken       string `json:"refreshToken"`
	DeviceID           string `json:"deviceId"`
	DeviceLimitReached bool   `json:"deviceLimitReached"`
	License            *struct {
		Plan       string   `json:"plan"`
		PlanCode   string   `json:"planCode"`
		Tier       string   `json:"tier"`
		MaxDevices int      `json:"maxDevices"`
		Features   []string `json:"features"`
	} `json:"license"`
}

func (c *Client) authenticate(path, username, password string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result authResult
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := c.request(ctx, http.MethodPost, path, map[string]any{
		"username": username, "password": password,
		"device": map[string]any{"fingerprint": c.fingerprint, "hardwareHash": c.hardwareHash, "name": c.deviceName, "platform": "windows", "appVersion": normalizedVersion(c.version)},
	}, &result, "")
	if err != nil {
		return err
	}
	c.state = state{Username: strings.TrimSpace(username), AccessToken: result.AccessToken, RefreshToken: result.RefreshToken, DeviceID: result.DeviceID, PendingDevice: result.DeviceLimitReached}
	if result.License != nil {
		c.state.Plan, c.state.PlanCode, c.state.Tier, c.state.MaxDevices, c.state.Features = result.License.Plan, result.License.PlanCode, result.License.Tier, result.License.MaxDevices, result.License.Features
		if !result.DeviceLimitReached {
			if err := c.acquireLeaseLocked(ctx); err != nil {
				c.state = state{}
				return err
			}
		}
	}
	return c.saveLocked()
}

func (c *Client) Login(username, password string) error {
	return c.authenticate("/v1/auth/login", username, password)
}

func (c *Client) Register(username, password string) error {
	return c.authenticate("/v1/auth/register", username, password)
}

func (c *Client) Plans() ([]Plan, error) {
	var result struct {
		Items []Plan `json:"items"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.request(ctx, http.MethodGet, "/v1/catalog/plans", nil, &result, ""); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (c *Client) Announcements() ([]Announcement, error) {
	var result struct {
		Items []Announcement `json:"items"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.request(ctx, http.MethodGet, "/v1/announcements", nil, &result, ""); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (c *Client) authedRequestLocked(ctx context.Context, method, path string, input, output any) error {
	if c.state.AccessToken == "" {
		return errors.New("请先登录")
	}
	if err := c.request(ctx, method, path, input, output, c.state.AccessToken); err == nil {
		return nil
	}
	if err := c.refreshLocked(ctx); err != nil {
		return err
	}
	if err := c.request(ctx, method, path, input, output, c.state.AccessToken); err != nil {
		return err
	}
	_ = c.saveLocked()
	return nil
}

func (c *Client) Devices() ([]Device, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result struct {
		Items []Device `json:"items"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodGet, "/v1/me/devices", nil, &result); err != nil {
		return nil, err
	}
	for i := range result.Items {
		result.Items[i].Current = result.Items[i].ID == c.state.DeviceID
	}
	return result.Items, nil
}

func (c *Client) UnbindDevice(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodDelete, "/v1/me/devices/"+url.PathEscape(id), nil, nil); err != nil {
		return err
	}
	if id == c.state.DeviceID {
		c.state = state{}
		_ = os.Remove(c.path)
	}
	return nil
}

// ActivateCurrentDevice converts the short-lived "名额已满" login into a real
// device binding after the user removes an old device. Until this succeeds no
// lease is held, therefore Service.Start remains blocked.
func (c *Client) ActivateCurrentDevice() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.state.PendingDevice || c.state.AccessToken == "" {
		return errors.New("当前设备无需激活或请重新登录")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var result authResult
	err := c.request(ctx, http.MethodPost, "/v1/me/device/activate", map[string]any{"device": map[string]any{"fingerprint": c.fingerprint, "hardwareHash": c.hardwareHash, "name": c.deviceName, "platform": "windows", "appVersion": normalizedVersion(c.version)}}, &result, c.state.AccessToken)
	if err != nil {
		return err
	}
	c.state.AccessToken, c.state.RefreshToken, c.state.DeviceID, c.state.PendingDevice = result.AccessToken, result.RefreshToken, result.DeviceID, false
	if result.License != nil {
		c.state.Plan, c.state.PlanCode, c.state.Tier, c.state.MaxDevices, c.state.Features = result.License.Plan, result.License.PlanCode, result.License.Tier, result.License.MaxDevices, result.License.Features
	}
	if err := c.acquireLeaseLocked(ctx); err != nil {
		return err
	}
	return c.saveLocked()
}

func (c *Client) Orders() ([]Order, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result struct {
		Items []Order `json:"items"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodGet, "/v1/me/orders", nil, &result); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (c *Client) CreateOrder(planID string) (Order, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result Order
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/orders", map[string]string{"planId": planID}, &result)
	return result, err
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
	c.state.Lease, c.state.DeviceID, c.state.Plan, c.state.PlanCode, c.state.Tier, c.state.MaxDevices, c.state.Features = result.Lease, claims.DeviceID, claims.Plan, claims.PlanCode, claims.Tier, claims.MaxDevices, claims.Features
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
	if claims.Subject == "" || claims.DeviceID == "" || claims.FingerprintHash == "" || claims.Expires == 0 || claims.EntitlementExpires == 0 || claims.GraceHours < 0 || claims.GraceHours > 72 {
		return claims, errors.New("授权租约期限无效")
	}
	expectedFingerprint := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
	if claims.FingerprintHash != hex.EncodeToString(expectedFingerprint[:]) || (c.state.DeviceID != "" && claims.DeviceID != c.state.DeviceID) {
		return claims, errors.New("授权租约与当前设备不匹配")
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
	status := Status{Enabled: c.Enabled(), SignedIn: c.state.AccessToken != "", Username: c.state.Username, Plan: c.state.Plan, PlanCode: c.state.PlanCode, Tier: c.state.Tier, MaxDevices: c.state.MaxDevices, Features: append([]string{}, c.state.Features...), DeviceLimitReached: c.state.PendingDevice}
	if !status.Enabled {
		status.Authenticated = true
		return status
	}
	claims, err := c.verifyLease(c.state.Lease)
	if err != nil {
		if status.DeviceLimitReached {
			status.Error = "本机尚未激活：设备数量已达上限，请解绑一台旧设备"
		} else if status.SignedIn && c.state.Lease == "" {
			status.Error = "当前账号暂无有效会员，请选择套餐开通"
		} else {
			status.Error = err.Error()
		}
		return status
	}
	status.Plan = claims.Plan
	status.PlanCode = claims.PlanCode
	status.Tier = claims.Tier
	status.MaxDevices = claims.MaxDevices
	status.Features = append([]string{}, claims.Features...)
	expires := time.Unix(claims.Expires, 0)
	offlineUntil := expires.Add(time.Duration(claims.GraceHours) * time.Hour)
	entitlementUntil := time.Unix(claims.EntitlementExpires, 0)
	if entitlementUntil.Before(offlineUntil) {
		offlineUntil = entitlementUntil
	}
	status.ExpiresAt, status.OfflineUntil = expires.Format(time.RFC3339), offlineUntil.Format(time.RFC3339)
	status.Authenticated = time.Now().Before(offlineUntil)
	if !status.Authenticated {
		status.Error = "授权已过期，请联网重新登录"
	}
	return status
}

func (c *Client) RefreshEntitlement() error {
	if !c.Enabled() {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := c.refreshLocked(ctx); err != nil {
		return err
	}
	if err := c.acquireLeaseLocked(ctx); err != nil {
		return err
	}
	return c.saveLocked()
}

func (c *Client) EnsureEntitled() error {
	if !c.Enabled() {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	var onlineErr error
	if c.state.RefreshToken != "" {
		if err := c.refreshLocked(ctx); err != nil {
			onlineErr = err
		} else if err := c.acquireLeaseLocked(ctx); err != nil {
			onlineErr = err
		} else {
			_ = c.saveLocked()
			return nil
		}
	}
	var apiErr *APIError
	if errors.As(onlineErr, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
		// A definitive authenticated rejection (expired membership, suspended
		// account, unbound device) must stop immediately. Offline grace is only
		// for network/server outages, never for an explicit revocation.
		c.state.Lease = ""
		_ = c.saveLocked()
		return onlineErr
	}
	claims, err := c.verifyLease(c.state.Lease)
	if err != nil {
		return err
	}
	offlineUntil := time.Unix(claims.Expires, 0).Add(time.Duration(claims.GraceHours) * time.Hour)
	if entitlementUntil := time.Unix(claims.EntitlementExpires, 0); entitlementUntil.Before(offlineUntil) {
		offlineUntil = entitlementUntil
	}
	if time.Now().After(offlineUntil) {
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
