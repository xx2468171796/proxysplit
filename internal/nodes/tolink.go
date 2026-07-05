package nodes

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"strconv"
)

// ToLink returns a share link for the node. For nodes parsed from a share link
// the original Raw link is returned verbatim; for manually-added socks/http
// nodes a link is synthesized. Returns "" when no link can be produced.
func ToLink(n *Node) string {
	if n == nil {
		return ""
	}
	if n.Raw != "" {
		return n.Raw
	}
	switch n.Type {
	case "socks", "socks5":
		userinfo := ""
		if n.Username != "" || n.Password != "" {
			b64 := base64.StdEncoding.EncodeToString([]byte(n.Username + ":" + n.Password))
			userinfo = b64 + "@"
		}
		return fmt.Sprintf("socks://%s%s:%s#%s", userinfo, n.Server, strconv.Itoa(n.Port), url.QueryEscape(n.Name))
	case "http", "https":
		userinfo := ""
		if n.Username != "" || n.Password != "" {
			userinfo = url.UserPassword(n.Username, n.Password).String() + "@"
		}
		return fmt.Sprintf("http://%s%s:%s#%s", userinfo, n.Server, strconv.Itoa(n.Port), url.QueryEscape(n.Name))
	default:
		return ""
	}
}
