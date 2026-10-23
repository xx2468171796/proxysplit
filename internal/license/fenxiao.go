package license

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Fenxiao calls the signed-in user's own multi-level referral endpoints
// (/v1/fenxiao/*: invite link, earnings, team, commissions, withdrawals). The
// response is handed to the UI as raw JSON; the server already masks other
// users' names. Callers pass a fixed path built from an allow-list (app_fenxiao.go).
func (c *Client) Fenxiao(method, path string, input any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out json.RawMessage
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if method != http.MethodPost {
		input = nil
	}
	err := c.authedRequestLocked(ctx, method, path, input, &out)
	return out, err
}
