package powervpn

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"proxysplit/internal/nodes"
)

// Profile is the signed client configuration (design §2).
type Profile struct {
	Version  int       `json:"version"`
	IssuedAt string    `json:"issuedAt"`
	Accounts []Account `json:"accounts"`
}

// Account is one proxy account (AccountProfile).
type Account struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	ExpiresAt *string `json:"expiresAt"`
	Traffic   struct {
		UsedBytes int64  `json:"usedBytes"`
		CapBytes  *int64 `json:"capBytes"`
	} `json:"traffic"`
	MaxDevices *int `json:"maxDevices"`
	Device     struct {
		Status  string `json:"status"` // active | limit_reached | revoked
		Message string `json:"message"`
	} `json:"device"`
	Outbounds []json.RawMessage `json:"outbounds"`
	Nodes     []struct {
		Tag      string `json:"tag"`
		Outbound string `json:"outbound"`
		// Key is the panel's stable node identity within the account ("auto",
		// "relay:<id>", "landing:<id>", "chain:<id>"); optional (older panels).
		Key string `json:"key"`
	} `json:"nodes"`
	// Egress: destinations this account's nodes will not carry (blocked list,
	// 仅 AI) — routed direct instead (panel 2026-10-01+; absent on older panels).
	Egress *nodes.Egress `json:"egress"`
}

// ErrProfileSignature: a POWER云 profile whose signature does not verify with
// the built-in panel key — in practice the panel's key or signing format is
// newer than this build. errors.Is(err, ErrBadSignature) holds too.
var ErrProfileSignature error = profileSignatureError{}

type profileSignatureError struct{}

func (profileSignatureError) Error() string {
	return "POWER云 配置签名校验失败，请升级 ProxySplit"
}
func (profileSignatureError) Unwrap() error { return ErrBadSignature }

// ParseSignedProfile verifies (type "profile") and decodes a profile body.
func ParseSignedProfile(v Verifier, h http.Header, body []byte) (*Profile, error) {
	if err := VerifyResponse(v, SigTypeProfile, h, body); err != nil {
		return nil, ErrProfileSignature
	}
	var p Profile
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("POWER云 配置无法解析：%w", err)
	}
	if p.Version != 1 {
		return nil, fmt.Errorf("POWER云 配置版本 %d 不受支持，请升级 ProxySplit", p.Version)
	}
	return &p, nil
}

// Nodes converts the profile into official nodes. Accounts whose device is not
// active contribute no nodes, only their message (e.g. device limit reached).
func (p *Profile) Nodes() (list []*nodes.Node, notices []string) {
	multi := len(p.Accounts) > 1
	for _, a := range p.Accounts {
		if a.Device.Status != "" && a.Device.Status != "active" {
			msg := strings.TrimSpace(a.Device.Message)
			if msg == "" {
				msg = "本设备无法使用该线路（" + a.Device.Status + "）"
			}
			if multi && a.Name != "" {
				msg = a.Name + "：" + msg
			}
			notices = append(notices, msg)
			continue
		}
		if len(a.Nodes) == 0 {
			// Active device but nothing to connect (expired / no traffic / no
			// nodes): the panel explains why in device.message.
			if msg := strings.TrimSpace(a.Device.Message); msg != "" {
				if multi && a.Name != "" {
					msg = a.Name + "：" + msg
				}
				notices = append(notices, msg)
			}
			continue
		}
		for _, n := range a.Nodes {
			closure, err := nodes.OutboundClosure(a.Outbounds, n.Outbound)
			if err != nil {
				notices = append(notices, fmt.Sprintf("节点 %s 配置不完整，已跳过", n.Tag))
				continue
			}
			name := n.Tag
			if multi && a.Name != "" {
				name = a.Name + " · " + n.Tag
			}
			node := &nodes.Node{
				ID: officialID(a.ID, n.Tag), Name: name, Official: true, AccountID: a.ID,
				Outbounds: closure, EntryTag: n.Outbound,
			}
			if a.Egress.Active() {
				node.Egress = a.Egress
			}
			if key := strings.TrimSpace(n.Key); key != "" {
				node.OfficialKey = a.ID + "/" + key
				node.ID = officialID(a.ID, "key/"+key)
			}
			node.Type, node.Server, node.Port = nodes.EndpointOf(closure)
			list = append(list, node)
		}
	}
	return list, notices
}

// officialID derives a node ID from the account and the node's identity: the
// panel's stable key when present, else (older panels) the tag — which moves
// with the node's list position.
func officialID(accountID, tag string) string {
	sum := sha256.Sum256([]byte("powervpn\x00" + accountID + "\x00" + tag))
	return "pv-" + hex.EncodeToString(sum[:8])
}
