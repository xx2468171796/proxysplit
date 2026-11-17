package license

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

// accessRefreshMargin is how long before the access token's expiry it is
// renewed: two watchdog ticks, so one missed tick never leaves it expired.
const accessRefreshMargin = 2 * time.Minute

// accessTokenLifetime reads how long the server issued the access token for
// (exp − iat, both on the server's clock). 0 when the token cannot be read.
func accessTokenLifetime(token string) time.Duration {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0
	}
	var claims struct {
		IssuedAt int64 `json:"iat"`
		Expires  int64 `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil || claims.IssuedAt <= 0 || claims.Expires <= claims.IssuedAt {
		return 0
	}
	return time.Duration(claims.Expires-claims.IssuedAt) * time.Second
}

// accessTokenStaleLocked reports whether the access token must be renewed
// before use. Its age is measured on the local clock from the moment it was
// received (SessionValidatedAt) against the server-issued lifetime, so a wrong
// system clock cannot make a fresh token look expired or the reverse. Anything
// unknown (unreadable token, no receive time, clock set back) counts as stale.
func (c *Client) accessTokenStaleLocked(now time.Time) bool {
	lifetime := accessTokenLifetime(c.state.AccessToken)
	received := c.state.SessionValidatedAt
	if lifetime <= 0 || received <= 0 || received > now.Unix() {
		return true
	}
	margin := accessRefreshMargin
	if margin > lifetime/2 {
		margin = lifetime / 2
	}
	return now.Sub(time.Unix(received, 0)) >= lifetime-margin
}

// renewOnlineLocked is the periodic online check: it rotates the refresh token
// only when the access token is about to expire (about once per access-token
// lifetime, not once per watchdog tick), then asks for a fresh lease. The
// lease call is what notices a suspended account or an unbound device, so
// revocation is still detected on every tick.
func (c *Client) renewOnlineLocked(ctx context.Context) error {
	if c.accessTokenStaleLocked(time.Now()) {
		if err := c.refreshLocked(ctx); err != nil {
			return err
		}
	}
	return c.acquireLeaseLocked(ctx)
}
