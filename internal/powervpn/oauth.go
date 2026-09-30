package powervpn

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

// LoginTimeout bounds the whole browser round trip.
const LoginTimeout = 5 * time.Minute

type pkce struct{ verifier, challenge, state string }

func newPKCE() (pkce, error) {
	buf := make([]byte, 64)
	if _, err := rand.Read(buf); err != nil {
		return pkce{}, err
	}
	verifier := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(verifier))
	st := make([]byte, 24)
	if _, err := rand.Read(st); err != nil {
		return pkce{}, err
	}
	return pkce{verifier: verifier, challenge: base64.RawURLEncoding.EncodeToString(sum[:]), state: base64.RawURLEncoding.EncodeToString(st)}, nil
}

// AuthorizeURL builds the panel consent URL (design §1.1).
func (c *Client) AuthorizeURL(redirectURI, state, challenge string) string {
	q := url.Values{
		"client_id":             {ClientID},
		"redirect_uri":          {redirectURI},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	return c.base + "/oauth/authorize?" + q.Encode()
}

const callbackPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>ProxySplit</title>
<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f7fb;color:#1f2937}div{text-align:center}h1{font-size:20px}</style>
</head><body><div><h1>%s</h1><p>%s</p></div></body></html>`

// Login runs the OAuth 2.0 authorization-code + PKCE flow through a loopback
// listener on a random port: opens the browser, waits (≤ 5 min) for the
// callback, checks state, exchanges the code and stores the tokens.
func (c *Client) Login(ctx context.Context, openBrowser func(string) error) error {
	p, err := newPKCE()
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("无法启动本机回调：%w", err)
	}
	redirect := fmt.Sprintf("http://127.0.0.1:%d/callback", ln.Addr().(*net.TCPAddr).Port)

	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	send := func(r result) {
		select {
		case done <- r:
		default:
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(p.state)) != 1 {
			// Not ours (stale tab / forged request): don't end the flow.
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(w, callbackPage, "登录请求无效", "请回到 ProxySplit 重新点击「用 POWER云 账号登录」。")
			return
		}
		if e := q.Get("error"); e != "" {
			fmt.Fprintf(w, callbackPage, "已取消授权", "可以关闭此页面。")
			send(result{err: errors.New("已取消 POWER云 授权")})
			return
		}
		code := q.Get("code")
		if code == "" {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(w, callbackPage, "登录失败", "缺少授权码，请重试。")
			send(result{err: errors.New("POWER云 未返回授权码")})
			return
		}
		fmt.Fprintf(w, callbackPage, "登录成功", "已授权 ProxySplit，可以关闭此页面返回软件。")
		send(result{code: code})
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer func() {
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()

	if err := openBrowser(c.AuthorizeURL(redirect, p.state, p.challenge)); err != nil {
		return fmt.Errorf("无法打开浏览器：%w", err)
	}
	wait, cancel := context.WithTimeout(ctx, LoginTimeout)
	defer cancel()
	var res result
	select {
	case res = <-done:
	case <-wait.Done():
		return errors.New("等待 POWER云 授权超时（5 分钟），请重试")
	}
	if res.err != nil {
		return res.err
	}
	xctx, xcancel := context.WithTimeout(ctx, 30*time.Second)
	defer xcancel()
	tok, err := c.tokenRequest(xctx, map[string]string{
		"grant_type": "authorization_code", "code": res.code, "code_verifier": p.verifier, "redirect_uri": redirect,
	})
	if err != nil {
		return err
	}
	if err := c.setToken(tok); err != nil {
		return err
	}
	if me, err := c.Me(xctx); err == nil {
		c.SetUsername(firstNonEmpty(me.DisplayName, me.Username, me.Email))
	}
	return nil
}

// TicketGrant is the panel's grant_type for one-time download tickets.
const TicketGrant = "urn:powervpn:download-ticket"

// ErrTicketRejected: the download ticket was already used, expired or unknown.
var ErrTicketRejected = errors.New("下载凭据无效、已过期或已使用")

// LoginWithTicket redeems the one-time ticket the AI site put into the file
// name of a signed-in customer's download (no browser round trip) and stores
// the grant exactly like Login does.
func (c *Client) LoginWithTicket(ctx context.Context, ticket string) error {
	tok, err := c.tokenRequest(ctx, map[string]string{"grant_type": TicketGrant, "ticket": ticket})
	if err != nil {
		if errors.Is(err, errGrantRejected) {
			return ErrTicketRejected
		}
		return err
	}
	if err := c.setToken(tok); err != nil {
		return err
	}
	if me, err := c.Me(ctx); err == nil {
		c.SetUsername(firstNonEmpty(me.DisplayName, me.Username, me.Email))
	}
	return nil
}
