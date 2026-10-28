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

// SendSMSCode asks the server to text a 6-digit code for purpose
// (register / reset / bind). "bind" needs a signed-in session.
func (c *Client) SendSMSCode(phone, purpose string) error {
	p, err := NormalizePhone(phone)
	if err != nil {
		return err
	}
	if purpose != SMSRegister && purpose != SMSReset && purpose != SMSBind {
		return errors.New("验证码用途无效")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	body := map[string]any{"phone": p, "purpose": purpose}
	if purpose == SMSBind {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.authedRequestLocked(ctx, http.MethodPost, "/v1/auth/sms/send", body, nil)
	}
	return c.request(ctx, http.MethodPost, "/v1/auth/sms/send", body, nil, "")
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
func (c *Client) BindPhone(phone, code string) error {
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
	if err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/me/phone", map[string]any{"phone": p, "code": sms}, nil); err != nil {
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
