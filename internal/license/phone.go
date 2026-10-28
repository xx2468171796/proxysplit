package license

import (
	"context"
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

// SendSMSCode asks the server to text a 6-digit code for purpose
// (register / reset / bind) and returns the server's resend cooldown in
// seconds. "bind" needs a signed-in session.
func (c *Client) SendSMSCode(phone, purpose string) (int, error) {
	p, err := NormalizePhone(phone)
	if err != nil {
		return 0, err
	}
	if purpose != SMSRegister && purpose != SMSReset && purpose != SMSBind {
		return 0, errors.New("验证码用途无效")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	body := map[string]any{"phone": p, "purpose": purpose}
	var out struct {
		CooldownSeconds int `json:"cooldownSeconds"`
	}
	if purpose == SMSBind {
		c.mu.Lock()
		err = c.authedRequestLocked(ctx, http.MethodPost, "/v1/auth/sms/send", body, &out)
		c.mu.Unlock()
	} else {
		err = c.request(ctx, http.MethodPost, "/v1/auth/sms/send", body, &out, "")
	}
	if err != nil {
		return 0, err
	}
	if out.CooldownSeconds <= 0 || out.CooldownSeconds > 3600 {
		out.CooldownSeconds = DefaultSMSCooldown
	}
	return out.CooldownSeconds, nil
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
