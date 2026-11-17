package license

import (
	"errors"
	"net/http"
)

// definitiveRejectionCodes are the server error codes (server core auth.ts)
// that mean this session or device was really revoked: account suspended or
// deleted, device unbound / fingerprint mismatch, refresh token revoked or
// replayed. DEVICE_LIMIT is deliberately absent: it keeps the session so the
// unbind screen can free a slot (isDeviceLimit).
var definitiveRejectionCodes = map[string]bool{
	"ACCOUNT_UNAVAILABLE": true,
	"DEVICE_MISMATCH":     true,
	"REFRESH_INVALID":     true,
	"REFRESH_REPLAY":      true,
}

// isDefinitiveRejection is the one place that decides whether a failed
// refresh / lease call revokes the cached session. Only our own API saying so
// counts: a 4xx carrying one of definitiveRejectionCodes. A rate limit (429),
// 408 / 425, or a 4xx without our JSON error code (WAF or captive-portal HTML
// page, proxy 404) is transient, exactly like a network failure — the caller
// keeps the session and lease and falls back to the offline grace.
func isDefinitiveRejection(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	switch apiErr.Status {
	case http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests:
		return false
	}
	if apiErr.Status < 400 || apiErr.Status >= 500 {
		return false
	}
	return definitiveRejectionCodes[apiErr.Code]
}

// revokeLocked ends the session and the lease together. A lease is only ever
// held by a signed-in session: dropping one without the other either shows a
// paying customer "signed in, no membership" or lets a suspended account keep
// the proxy until lease + grace run out. The user name and plan summary stay
// so the sign-in form is prefilled.
func (c *Client) revokeLocked() {
	c.state.AccessToken = ""
	c.state.RefreshToken = ""
	c.state.DeviceID = ""
	c.state.PendingDevice = false
	c.state.SessionValidatedAt = 0
	c.state.Lease = ""
}

// applyRejectionLocked is the one place a failed refresh / lease call changes
// the cached state, and it saves the change. It reports whether err was an
// explicit rejection:
//   - a definitive rejection (isDefinitiveRejection) revokes session and lease;
//   - DEVICE_LIMIT drops the lease but keeps the session, so the unbind screen
//     can free a slot;
//   - anything else (network failure, rate limit, WAF page) changes nothing.
func (c *Client) applyRejectionLocked(err error) bool {
	switch {
	case isDefinitiveRejection(err):
		c.revokeLocked()
	case isDeviceLimit(err):
		c.state.PendingDevice = true
		c.state.Lease = ""
	default:
		return false
	}
	_ = c.saveLocked()
	return true
}

// dropOrphanLeaseLocked removes a lease that has no session behind it and
// reports whether it did. Clients up to v1.12.5 kept the lease when a refresh
// was rejected; such a state must not authenticate after the upgrade.
func (c *Client) dropOrphanLeaseLocked() bool {
	if c.state.RefreshToken != "" || c.state.Lease == "" {
		return false
	}
	c.state.Lease = ""
	return true
}
