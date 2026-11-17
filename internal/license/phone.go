package license

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Phone-number accounts: SMS codes, phone registration, password reset by
// SMS (once per phone per Beijing day, enforced server-side) and binding a
// phone to an older account.

// SMS code purposes accepted by POST /v1/auth/sms/send.
const (
	SMSRegister = "register"
	SMSReset    = "reset"
	SMSBind     = "bind"
)

var mainlandPhone = regexp.MustCompile(`^1\d{10}$`)

// NormalizePhone strips spaces / dashes / a +86 prefix and checks it is an
// 11-digit mainland mobile number.
func NormalizePhone(raw string) (string, error) {
	p := strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(raw))
	p = strings.TrimPrefix(strings.TrimPrefix(p, "+86"), "86")
	if len(p) == 13 && strings.HasPrefix(p, "86") {
		p = p[2:]
	}
	if !mainlandPhone.MatchString(p) {
		return "", errors.New("请输入 11 位手机号")
	}
	return p, nil
}

// isMemberTier: every tier except the free one (and "no tier yet") is paid.
func isMemberTier(tier string) bool {
	t := strings.TrimSpace(tier)
	return t != "" && t != "free"
}

func validCode(code string) (string, error) {
	c := strings.TrimSpace(code)
	if len(c) != 6 || strings.Trim(c, "0123456789") != "" {
		return "", errors.New("请输入 6 位短信验证码")
	}
	return c, nil
}

// DefaultSMSCooldown is used when the server does not say how long to wait.
const DefaultSMSCooldown = 60

// MaxCaptchaTicket is the longest human-verification ticket the server
// accepts; anything longer is dropped (sent as "no ticket").
const MaxCaptchaTicket = 2048

// SMSSent is the server's answer to a sent code.
type SMSSent struct {
	// CooldownSeconds is the resend wait. On an error it is only set when the
	// server said how long to wait (sending too often).
	CooldownSeconds int
	// Message is the server's wording for "sent" (may be empty).
	Message string
}

// smsDeviceID is a per-device value the verification center uses for its
// per-device send limit; it is derived so the real fingerprint stays private.
func (c *Client) smsDeviceID() string {
	if c.fingerprint == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("ProxySplit-SMS-Device-v1\x00" + c.fingerprint))
	return hex.EncodeToString(sum[:16])
}

// SendSMSCode asks the server to text a 6-digit code for purpose
// (register / reset / bind). captchaTicket is the one-time ticket from the
// human verification (frontend human-verify, action "sms"); it is always
// sent, empty when none could be obtained, so the server can tell this
// client from older ones that do not know about the verification.
// "bind" needs a signed-in session.
func (c *Client) SendSMSCode(phone, purpose, captchaTicket string) (SMSSent, error) {
	p, err := NormalizePhone(phone)
	if err != nil {
		return SMSSent{}, err
	}
	if purpose != SMSRegister && purpose != SMSReset && purpose != SMSBind {
		return SMSSent{}, errors.New("验证码用途无效")
	}
	ticket := strings.TrimSpace(captchaTicket)
	if len(ticket) > MaxCaptchaTicket {
		ticket = ""
	}
	// A reset send is padded server-side to at least 2.5 s (so registered and
	// unregistered numbers look alike), on top of redeeming the ticket.
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	body := map[string]any{"phone": p, "purpose": purpose, "captchaTicket": ticket}
	if id := c.smsDeviceID(); id != "" {
		body["deviceFp"] = id
	}
	var out struct {
		CooldownSeconds int    `json:"cooldownSeconds"`
		Message         string `json:"message"`
	}
	if purpose == SMSBind {
		c.mu.Lock()
		err = c.authedRequestLocked(ctx, http.MethodPost, "/v1/auth/sms/send", body, &out)
		c.mu.Unlock()
	} else {
		err = c.request(ctx, http.MethodPost, "/v1/auth/sms/send", body, &out, "")
	}
	if err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) {
			return SMSSent{CooldownSeconds: apiErr.CooldownSeconds}, err
		}
		return SMSSent{}, err
	}
	if out.CooldownSeconds <= 0 || out.CooldownSeconds > 3600 {
		out.CooldownSeconds = DefaultSMSCooldown
	}
	return SMSSent{CooldownSeconds: out.CooldownSeconds, Message: out.Message}, nil
}

// RegisterPhone creates a phone account and signs this device in.
func (c *Client) RegisterPhone(phone, code, username, password, ref string) error {
	p, err := NormalizePhone(phone)
	if err != nil {
		return err
	}
	sms, err := validCode(code)
	if err != nil {
		return err
	}
	payload := map[string]any{"phone": p, "code": sms, "username": strings.TrimSpace(username), "password": password, "device": c.devicePayload()}
	if ref = strings.TrimSpace(ref); ref != "" {
		payload["ref"] = ref
	}
	return c.authenticatePayload("/v1/auth/register", strings.TrimSpace(username), payload)
}

// ResetPassword sets a new password with an SMS code; the server revokes
// every session of that account, so the user signs in again afterwards.
func (c *Client) ResetPassword(phone, code, password string) error {
	p, err := NormalizePhone(phone)
	if err != nil {
		return err
	}
	sms, err := validCode(code)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return c.request(ctx, http.MethodPost, "/v1/auth/password/reset", map[string]any{"phone": p, "code": sms, "password": password}, nil, "")
}

// BindPhone attaches a phone number to the signed-in (older) account.
// Changing an already bound phone needs the current login password.
func (c *Client) BindPhone(phone, code, currentPassword string) error {
	p, err := NormalizePhone(phone)
	if err != nil {
		return err
	}
	sms, err := validCode(code)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	body := map[string]any{"phone": p, "code": sms}
	if currentPassword != "" {
		body["currentPassword"] = currentPassword
	}
	if err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/me/phone", body, nil); err != nil {
		return err
	}
	bound := true
	c.state.PhoneBound = &bound
	return c.saveLocked()
}

// RefreshProfile re-reads /v1/me so phoneBound and the free / plan device
// split stay current (they are not part of the signed lease).
func (c *Client) RefreshProfile() error {
	if !c.Enabled() {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state.AccessToken == "" {
		return nil
	}
	var result struct {
		User    *authUser    `json:"user"`
		License *licenseInfo `json:"license"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.authedRequestLocked(ctx, http.MethodGet, "/v1/me", nil, &result); err != nil {
		return err
	}
	if result.User != nil && result.User.PhoneBound != nil {
		c.state.PhoneBound = result.User.PhoneBound
	}
	if result.License != nil {
		c.state.FreeDevices, c.state.PlanDevices = result.License.FreeDevices, result.License.PlanDevices
	}
	return c.saveLocked()
}
