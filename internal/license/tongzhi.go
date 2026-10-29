package license

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// tongzhiPaths is the allow-list of player-side tongzhi routes (公司统一通知包,
// server mounts them at /v1/tongzhi). The UI's tongzhi client sends its fetches
// through the Wails binding, so only these sub-paths may reach the server.
var tongzhiPaths = map[string]string{
	"/bundle": http.MethodGet, "/feed": http.MethodGet, "/unread": http.MethodGet,
	"/seen": http.MethodPost, "/read": http.MethodPost, "/read-all": http.MethodPost,
	"/archive": http.MethodPost, "/dismiss": http.MethodPost, "/popup-shown": http.MethodPost,
}

// Tongzhi forwards one inbox call with the signed-in session. It returns the
// HTTP status and JSON body the way fetch would see them, so the shared tongzhi
// browser client works unchanged on top of it.
func (c *Client) Tongzhi(method, pathAndQuery string, body json.RawMessage) (int, json.RawMessage, error) {
	sub, _, _ := strings.Cut(pathAndQuery, "?")
	if want, ok := tongzhiPaths[sub]; !ok || want != method {
		return http.StatusNotFound, nil, errors.New("不支持的通知接口")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var input any
	if method == http.MethodPost {
		input = body
		if len(body) == 0 {
			input = json.RawMessage(`{}`)
		}
	}
	var out json.RawMessage
	err := c.authedRequestLocked(ctx, method, "/v1/tongzhi"+pathAndQuery, input, &out)
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status, nil, err
	}
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, out, nil
}
