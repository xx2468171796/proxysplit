package license

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Catalog, devices, orders and other signed-in account calls (split out of
// client.go to keep files small).

// Catalog is the public plan list plus what the server says about the free
// tier and the way to pay right now, so the UI wording is not hard-coded.
type Catalog struct {
	Items []Plan `json:"items"`
	// PaymentMethods are "wechat" / "alipay", by the active payment channel
	// (empty: an older server; the pay dialog still tells by the pay link).
	PaymentMethods []string `json:"paymentMethods"`
	// FreeDevices is how many devices the free tier may use (nil: older server).
	FreeDevices *int `json:"freeDevices"`
}

func (c *Client) Catalog() (Catalog, error) {
	var result Catalog
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if err := c.request(ctx, http.MethodGet, "/v1/catalog/plans", nil, &result, ""); err != nil {
		return Catalog{}, err
	}
	return result, nil
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

// CreateOrder places a membership order. hvToken is the one-time pay-time
// human-verification token (LcVerify action=pay); empty = not sent.
func (c *Client) CreateOrder(planID, hvToken string) (Checkout, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var result Checkout
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	body := map[string]string{"planId": planID}
	if hvToken = strings.TrimSpace(hvToken); hvToken != "" {
		body["hvToken"] = hvToken
	}
	err := c.authedRequestLocked(ctx, http.MethodPost, "/v1/orders", body, &result)
	return result, err
}
