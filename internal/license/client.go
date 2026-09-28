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
	"encoding/pem"
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
	CheckoutURL string `json:"checkoutUrl"` // desktop cashier page; empty when the gateway gives none
	PaidAt      string `json:"paidAt"`
	ExpiresAt   string `json:"expiresAt"`
	CreatedAt   string `json:"createdAt"`
	SplitIndex  int    `json:"splitIndex"`
	SplitTotal  int    `json:"splitTotal"`
}

// Checkout is the result of creating an order. Split=true means the plan price
// exceeds the gateway per-transaction cap, so Orders holds several sub-orders
// that are paid one after another; the membership opens only after all are paid.
type Checkout struct {
	Split   bool    `json:"split"`
	GroupNo string  `json:"groupNo"`
	Orders  []Order `json:"orders"`
	Order   Order   `json:"order"`
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
	SchemaVersion      int      `json:"schemaVersion"`
	Username           string   `json:"username"`
	RefreshToken       string   `json:"refreshToken"`
	AccessToken        string   `json:"accessToken"`
	Lease              string   `json:"lease"`
	DeviceID           string   `json:"deviceId"`
	Plan               string   `json:"plan"`
	PlanCode           string   `json:"planCode"`
	Tier               string   `json:"tier"`
	MaxDevices         int      `json:"maxDevices"`
	Features           []string `json:"features"`
	PendingDevice      bool     `json:"pendingDevice"`
	SessionValidatedAt int64    `json:"sessionValidatedAt,omitempty"`
	// LastSeenAt is the latest clock reading seen while offline-valid; a clock
	// set back before it (or before the lease was issued) cannot extend the
	// offline grace. Reset from the server time on every online lease.
	LastSeenAt int64 `json:"lastSeenAt,omitempty"`
}

const stateSchemaVersion = 1

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
	IssuedAt           int64    `json:"iat"`
}

// clockSkewTolerance absorbs ordinary clock corrections (NTP sync, time zone
// glitches) before a backwards clock counts as tampering.
const clockSkewTolerance = 10 * time.Minute

var errClockRolledBack = errors.New("系统时间被调早了，请把电脑时间校准为当前时间并联网验证")

// checkClockLocked guards the offline grace against a system clock set back:
// "now" may not be earlier than when the lease was issued (server time) or
// than the latest time this client has already seen. It advances the
// high-water mark, persisting it at most every clockSkewTolerance.
func (c *Client) checkClockLocked(claims *leaseClaims, now time.Time) error {
	tol := int64(clockSkewTolerance / time.Second)
	t := now.Unix()
	if claims.IssuedAt > 0 && t < claims.IssuedAt-tol {
		return errClockRolledBack
	}
	if c.state.LastSeenAt > 0 && t < c.state.LastSeenAt-tol {
		return errClockRolledBack
	}
	if t > c.state.LastSeenAt {
		persist := t-c.state.LastSeenAt >= tol
		c.state.LastSeenAt = t
		if persist {
			_ = c.saveLocked()
		}
	}
	return nil
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
	// Release tooling may inject either base64(DER) or base64(PEM). Accept both
	// so a correctly provisioned production key cannot silently become nil.
	if block, _ := pem.Decode(der); block != nil {
		der = block.Bytes
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
	if err != nil {
		c.quarantineStateFile()
		return
	}
	var loaded state
	if err := json.Unmarshal(plain, &loaded); err != nil {
		c.quarantineStateFile()
		return
	}
	// Version 0 is the pre-versioning format shipped through v1.9.23. Its
	// fields are structurally compatible, so migrate it in place. A cache from
	// a newer client is deliberately left untouched so downgrading cannot
	// destroy credentials that the newer version still understands.
	if loaded.SchemaVersion > stateSchemaVersion {
		return
	}
	if loaded.SchemaVersion < 0 {
		c.quarantineStateFile()
		return
	}
	if loaded.SchemaVersion == 0 {
		loaded.SchemaVersion = stateSchemaVersion
		c.state = loaded
		_ = c.saveLocked()
		return
	}
	c.state = loaded
}

func (c *Client) quarantineStateFile() {
	suffix := time.Now().UTC().Format("20060102T150405.000000000Z")
	_ = os.Rename(c.path, c.path+".corrupt-"+suffix+".bak")
}

func (c *Client) saveLocked() error {
	c.state.SchemaVersion = stateSchemaVersion
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
	if input != nil {
		// Fastify rejects an empty request carrying application/json before the
		// route runs. DELETE /devices has no body, so do not advertise one.
		req.Header.Set("Content-Type", "application/json")
	}
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

func (c *Client) authenticate(path, username, email, password string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result authResult
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	payload := map[string]any{
		"username": username, "password": password,
		"device": map[string]any{"fingerprint": c.fingerprint, "hardwareHash": c.hardwareHash, "name": c.deviceName, "platform": "windows", "appVersion": normalizedVersion(c.version)},
	}
	if email != "" {
		payload["email"] = email
	}
	err := c.request(ctx, http.MethodPost, path, payload, &result, "")
	if err != nil {
		return err
	}
	c.state = state{SchemaVersion: stateSchemaVersion, Username: strings.TrimSpace(username), AccessToken: result.AccessToken, RefreshToken: result.RefreshToken, DeviceID: result.DeviceID, PendingDevice: result.DeviceLimitReached, SessionValidatedAt: time.Now().Unix()}
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
	return c.authenticate("/v1/auth/login", username, "", password)
}

func (c *Client) Register(username, email, password string) error {
	return c.authenticate("/v1/auth/register", username, email, password)
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
	err := c.request(ctx, method, path, input, output, c.state.AccessToken)
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusUnauthorized {
		// Retrying a non-idempotent request after a timeout/5xx can create a
		// second order even when the first request committed successfully.
		return err
	}
	if err := c.refreshLocked(ctx); err != nil {
		// A refresh token is a server-side session credential, not an offline
		// license. If the server definitively rejects it, stop presenting the
		// cached session as "signed in". Keep the signed lease so temporary
		// offline entitlement can still be evaluated independently.
		var refreshErr *APIError
		if errors.As(err, &refreshErr) && refreshErr.Status >= 400 && refreshErr.Status < 500 {
			c.clearOnlineSessionLocked()
			_ = c.saveLocked()
		}
		return err
	}
	if err := c.request(ctx, method, path, input, output, c.state.AccessToken); err != nil {
		return err
	}
	_ = c.saveLocked()
	return nil
}

func (c *Client) clearOnlineSessionLocked() {
	c.state.AccessToken = ""
	c.state.RefreshToken = ""
	c.state.DeviceID = ""
	c.state.PendingDevice = false
	c.state.SessionValidatedAt = 0
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

// Redeem applies a redeem / activation code to the signed-in account, then
// refreshes the entitlement and lease so the new membership takes effect
// immediately (same path a paid order uses).
func (c *Client) Redeem(code string) error {
	if !c.Enabled() {
		return errors.New("商业授权未启用")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/me/redeem", map[string]any{"code": code}, nil); err != nil {
		return err
	}
	// The code is now consumed and the entitlement granted server-side. From here
	// the redemption has SUCCEEDED: a refresh/lease failure (most often an outdated
	// client hitting the min-version wall) must NOT surface as a plain error that
	// makes the user redeem again — that was the old "redeem twice, double time"
	// bug. Persist whatever state we have and report success; /v1/me re-sync and
	// the mandatory-update prompt handle the stale-lease / upgrade path.
	_ = c.refreshLocked(ctx)
	_ = c.acquireLeaseLocked(ctx)
	return c.saveLocked()
}

// ChangePassword updates the signed-in account's password after verifying the
// current one server-side. The local session stays valid.
func (c *Client) ChangePassword(current, next string) error {
	if !c.Enabled() {
		return errors.New("商业授权未启用")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return c.authedRequestLocked(ctx, http.MethodPost, "/v1/me/password", map[string]any{
		"currentPassword": current, "newPassword": next,
	}, nil)
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

// AccelToken 取 Claude Code 加速令牌（服务端签发，24 小时有效；只给设备已激活、会员有效的账号）
func (c *Client) AccelToken() (string, time.Time, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/accel/token", map[string]any{}, &result); err != nil {
		return "", time.Time{}, err
	}
	if result.Token == "" {
		return "", time.Time{}, errors.New("服务端没有返回加速令牌")
	}
	return result.Token, result.ExpiresAt, nil
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

func (c *Client) CreateOrder(planID string) (Checkout, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result Checkout
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
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
	c.state.SessionValidatedAt = time.Now().Unix()
	// Refresh tokens are one-time credentials. Persist the rotated token before
	// any subsequent lease request so a lease/network failure cannot leave the
	// old, already-consumed token on disk.
	return c.saveLocked()
}

// ReconcileSession validates cached online credentials against the server
// before the first UI snapshot is rendered. Network failures keep the cache
// for offline use; a definitive 4xx rejection clears only the online session,
// never the independently signed offline lease.
func (c *Client) ReconcileSession(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.Enabled() || c.state.RefreshToken == "" {
		return nil
	}
	err := c.refreshLocked(ctx)
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
		c.clearOnlineSessionLocked()
		_ = c.saveLocked()
	}
	return err
}

func (c *Client) acquireLeaseLocked(ctx context.Context) error {
	var result struct {
		Lease string `json:"lease"`
	}
	if err := c.request(ctx, http.MethodPost, "/v1/license/lease", map[string]any{"deviceFingerprint": c.fingerprint, "appVersion": normalizedVersion(c.version)}, &result, c.state.AccessToken); err != nil {
		var apiErr *APIError
		if !errors.As(err, &apiErr) || apiErr.Status != http.StatusUnauthorized {
			return err
		}
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
	// A fresh lease carries the server's clock: restart the offline
	// high-water mark from it (this also heals a clock that ran fast).
	c.state.LastSeenAt = claims.IssuedAt
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
		return claims, ErrClientOutdated
	}
	return claims, nil
}

// ErrClientOutdated marks a lease rejected purely because the running client is
// older than the server-mandated minimum version. Callers that already applied a
// server-side state change (e.g. redeeming a code) use this to report "succeeded,
// please upgrade" instead of a plain failure that invites a duplicate retry.
var ErrClientOutdated = errors.New("当前客户端版本过低，请先升级")

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
	// ExpiresAt is the membership entitlement expiry shown to the user. The
	// short lease expiry is an implementation detail and must not make a
	// yearly membership look as if it only has one hour remaining.
	status.ExpiresAt, status.OfflineUntil = entitlementUntil.Format(time.RFC3339), offlineUntil.Format(time.RFC3339)
	now := time.Now()
	if err := c.checkClockLocked(&claims, now); err != nil {
		status.Error = err.Error()
		return status
	}
	status.Authenticated = now.Before(offlineUntil)
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
	now := time.Now()
	if err := c.checkClockLocked(&claims, now); err != nil {
		return err
	}
	if now.After(offlineUntil) {
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
