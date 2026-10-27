package license

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
)

// TelemetryDeviceID is sha256("proxysplit-device-v1:"+fingerprint): exactly
// devices.fingerprint_hash on the server, so client logs join to accounts
// without ever sending the fingerprint itself (it is a lease credential).
func (c *Client) TelemetryDeviceID() string {
	sum := sha256.Sum256([]byte("proxysplit-device-v1:" + c.fingerprint))
	return hex.EncodeToString(sum[:])
}

// AccessToken returns the current bearer token ("" when signed out). The
// telemetry endpoint accepts it optionally; an expired one is simply ignored.
func (c *Client) AccessToken() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state.AccessToken
}

// Username returns the signed-in username ("" when signed out).
func (c *Client) Username() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state.Username
}

// APIBase returns the configured API base URL ("" in dev builds).
func (c *Client) APIBase() string { return c.apiURL }

// DirectTransport is the pinned API transport with every proxy disabled: the
// API host is already a direct rule inside the core, and ignoring HTTP_PROXY
// keeps uploads off the tunnel even when the user set one.
func DirectTransport() http.RoundTripper {
	rt := pinnedTransport()
	if t, ok := rt.(*http.Transport); ok {
		t.Proxy = nil
	}
	return rt
}
