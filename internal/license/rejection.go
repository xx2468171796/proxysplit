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
