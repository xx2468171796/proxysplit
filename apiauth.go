package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
)

// The guard every control-API route goes through. The API listens on loopback
// only, but "loopback" is reachable from any web page the user opens (a page
// can make the browser send requests to 127.0.0.1) and from any local program,
// so the token alone is not the whole defence:
//
//   - Host must be a loopback name: a DNS-rebinding page reaches 127.0.0.1
//     under its own host name.
//   - No Origin header: our clients are curl and the --mcp bridge; browsers
//     attach Origin to cross-site requests, and nothing in a browser is meant
//     to use this API.
//   - The token comes in the Authorization header only (a URL token leaks into
//     history, logs and Referer) and is compared in constant time. The single
//     route served without it is /api/hello (apihello.go), which the --mcp
//     bridge uses to check the listener before it sends the token.
//   - GET never changes anything; a change is a POST with a JSON content type
//     (which an HTML form cannot send) and a bounded body.

// controlBodyLimit bounds a request body (a pasted list of share links is the
// largest legitimate one).
const controlBodyLimit = 1 << 20

func loopbackHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// bearerToken returns the token of an "Authorization: Bearer <token>" header.
func bearerToken(r *http.Request) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(r.Header.Get("Authorization")), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

// sameToken compares in constant time; hashing first hides the length too.
func sameToken(got, want string) bool {
	if got == "" || want == "" {
		return false
	}
	g, w := sha256.Sum256([]byte(got)), sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(g[:], w[:]) == 1
}

func jsonContentType(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}

// guard is the one place a control-API request is authenticated and checked
// before its route runs. The token is read per request, so regenerating it
// takes effect at once.
func (a *App) guard(rt controlRoute) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !loopbackHost(r.Host) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden: Host must be 127.0.0.1 or localhost"})
			return
		}
		if r.Header.Get("Origin") != "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden: browser requests (Origin header) are not accepted"})
			return
		}
		if !rt.open && !sameToken(bearerToken(r), a.svc.APIToken()) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized: send the header Authorization: Bearer <token>"})
			return
		}
		switch {
		case r.Method == http.MethodGet && rt.get != nil:
			rt.get(w, r)
		case r.Method == http.MethodPost && rt.post != nil:
			if !jsonContentType(r) {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "POST needs the header Content-Type: application/json (send {} when there are no parameters)"})
				return
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, controlBodyLimit))
			if err != nil {
				status := http.StatusBadRequest
				var tooLarge *http.MaxBytesError
				if errors.As(err, &tooLarge) {
					status = http.StatusRequestEntityTooLarge
				}
				writeJSON(w, status, map[string]string{"error": "request body unreadable or larger than 1 MB"})
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			rt.post(w, r)
		default:
			allow := make([]string, 0, 2)
			if rt.get != nil {
				allow = append(allow, http.MethodGet)
			}
			if rt.post != nil {
				allow = append(allow, http.MethodPost)
			}
			w.Header().Set("Allow", strings.Join(allow, ", "))
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed: this path accepts " + strings.Join(allow, " / ")})
		}
	}
}

// controlHandler is the whole control API behind the guard.
func (a *App) controlHandler() http.Handler {
	mux := http.NewServeMux()
	for _, route := range a.controlRoutes() {
		mux.HandleFunc(route.path, a.guard(route))
	}
	return mux
}

// newControlServer bounds how long a client may hold a connection. The write
// timeout leaves room for the slowest operation (the self test, about a
// minute).
func newControlServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      3 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}
