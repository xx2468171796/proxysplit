package license

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Cloud config sync (members only, server answers 403 SYNC_MEMBER_ONLY
// otherwise) and named cloud config profiles with share codes. Payloads are
// opaque JSON strings built by internal/configsync; the server stores them
// encrypted.

// ErrSyncConflict: the cloud copy changed since baseVersion (409 SYNC_CONFLICT).
var ErrSyncConflict = errors.New("云端配置已被其他设备更新")

// SyncMeta describes the cloud copy; Payload is only set when requested.
type SyncMeta struct {
	Exists     bool   `json:"exists"`
	Version    int    `json:"version"`
	UpdatedAt  string `json:"updatedAt"`
	DeviceName string `json:"deviceName"`
	Size       int    `json:"size"`
	Payload    string `json:"payload,omitempty"`
}

// Profile is one named cloud config (list view, no payload).
type Profile struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	DeviceName string `json:"deviceName"`
	Size       int    `json:"size"`
	UpdatedAt  string `json:"updatedAt"`
	Shared     bool   `json:"shared"`
	ShareCode  string `json:"shareCode,omitempty"`
	Locked     bool   `json:"locked"` // has a restore password
}

// ProfileList is GET /v1/me/config-profiles with the tier quota.
type ProfileList struct {
	Items []Profile `json:"items"`
	Quota int       `json:"quota"`
	Used  int       `json:"used"`
}

// NamedPayload is a restored / imported profile.
type NamedPayload struct {
	Name    string `json:"name"`
	Payload string `json:"payload"`
}

// IsMemberOnly reports the server's "cloud sync is a member feature" answer.
func IsMemberOnly(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusForbidden && apiErr.Code == "SYNC_MEMBER_ONLY"
}

// authed runs one signed-in request with the usual refresh-on-401 handling.
func (c *Client) authed(timeout time.Duration, method, path string, input, output any) error {
	if !c.Enabled() {
		return errors.New("商业授权未启用")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.authedRequestLocked(ctx, method, path, input, output)
}

// DeviceName is this computer's name as reported to the server.
func (c *Client) DeviceName() string { return c.deviceName }

// ConfigSyncGet reads the cloud copy; metaOnly skips the payload.
func (c *Client) ConfigSyncGet(metaOnly bool) (SyncMeta, error) {
	var meta SyncMeta
	path := "/v1/me/config-sync"
	if metaOnly {
		path += "?meta=1"
	}
	err := c.authed(20*time.Second, http.MethodGet, path, nil, &meta)
	return meta, err
}

// ConfigSyncPut uploads payload on top of baseVersion (optimistic lock) and
// returns the new version. ErrSyncConflict when another device won.
func (c *Client) ConfigSyncPut(payload string, baseVersion int) (int, error) {
	var meta SyncMeta
	err := c.authed(30*time.Second, http.MethodPut, "/v1/me/config-sync", map[string]any{"payload": payload, "baseVersion": baseVersion}, &meta)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict {
		return 0, ErrSyncConflict
	}
	if err != nil {
		return 0, err
	}
	if meta.Version <= 0 {
		meta.Version = baseVersion + 1
	}
	return meta.Version, nil
}

// ConfigSyncDelete removes the cloud copy.
func (c *Client) ConfigSyncDelete() error {
	return c.authed(15*time.Second, http.MethodDelete, "/v1/me/config-sync", nil, nil)
}

func profilePath(id string, suffix string) string {
	return "/v1/me/config-profiles/" + url.PathEscape(strings.TrimSpace(id)) + suffix
}

// ListProfiles lists the saved cloud configs and the tier quota.
func (c *Client) ListProfiles() (ProfileList, error) {
	var list ProfileList
	err := c.authed(15*time.Second, http.MethodGet, "/v1/me/config-profiles", nil, &list)
	if list.Items == nil {
		list.Items = []Profile{}
	}
	return list, err
}

// CreateProfile saves payload as a new named cloud config.
func (c *Client) CreateProfile(name, payload string) (Profile, error) {
	var p Profile
	err := c.authed(30*time.Second, http.MethodPost, "/v1/me/config-profiles", map[string]any{"name": strings.TrimSpace(name), "payload": payload}, &p)
	return p, err
}

// UpdateProfile renames and/or overwrites a profile (nil = unchanged).
func (c *Client) UpdateProfile(id string, name, payload *string) error {
	body := map[string]any{}
	if name != nil {
		body["name"] = strings.TrimSpace(*name)
	}
	if payload != nil {
		body["payload"] = *payload
	}
	return c.authed(30*time.Second, http.MethodPut, profilePath(id, ""), body, nil)
}

// RestoreProfile fetches a profile's payload; password is its optional
// restore password (403 RESTORE_PASSWORD_WRONG when wrong).
func (c *Client) RestoreProfile(id, password string) (NamedPayload, error) {
	var out NamedPayload
	body := map[string]any{}
	if password != "" {
		body["password"] = password
	}
	err := c.authed(30*time.Second, http.MethodPost, profilePath(id, "/restore"), body, &out)
	return out, err
}

// DeleteProfile removes a saved cloud config.
func (c *Client) DeleteProfile(id string) error {
	return c.authed(15*time.Second, http.MethodDelete, profilePath(id, ""), nil, nil)
}

// SetProfileRestorePassword sets, changes (current required) or clears
// (next == "") a profile's restore password.
func (c *Client) SetProfileRestorePassword(id, next, current string) error {
	body := map[string]any{"password": nil}
	if next != "" {
		body["password"] = next
	}
	if current != "" {
		body["currentPassword"] = current
	}
	return c.authed(15*time.Second, http.MethodPut, profilePath(id, "/restore-password"), body, nil)
}

// ShareProfile turns on sharing with password and returns the share code.
func (c *Client) ShareProfile(id, password string) (string, error) {
	var out struct {
		ShareCode string `json:"shareCode"`
	}
	if err := c.authed(15*time.Second, http.MethodPost, profilePath(id, "/share"), map[string]any{"password": password}, &out); err != nil {
		return "", err
	}
	if out.ShareCode == "" {
		return "", errors.New("服务端没有返回分享码")
	}
	return out.ShareCode, nil
}

// UnshareProfile turns sharing off (the old code stops working).
func (c *Client) UnshareProfile(id string) error {
	return c.authed(15*time.Second, http.MethodDelete, profilePath(id, "/share"), nil, nil)
}

// ImportShare fetches someone's shared config (any signed-in tier).
func (c *Client) ImportShare(code, password string) (NamedPayload, error) {
	var out NamedPayload
	body := map[string]any{"shareCode": strings.ToUpper(strings.TrimSpace(code)), "password": password}
	err := c.authed(30*time.Second, http.MethodPost, "/v1/config-share/import", body, &out)
	return out, err
}
