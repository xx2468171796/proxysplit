// Package powervpn talks to the POWER云 (PowerVPN) panel: OAuth account login,
// signed client profiles (official nodes), device registration and the
// platform-built sing-box core. Contract: PowerVPN repo
// openspec/changes/client-device-identity/design.md.
package powervpn

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// PanelPublicKey is the panel's Ed25519 client-signing public key: the raw
// 32-byte key, base64url (padding optional). The release sets it, e.g.
//
//	-ldflags "-X proxysplit/internal/powervpn.PanelPublicKey=<base64url>"
//
// Default: the production panel key (lxc.5fskins.com, 2026-09-29). If it is
// emptied, no signature verifies and every response is treated as a
// third-party subscription (compat mode) — safe, just without official nodes.
var PanelPublicKey = "iso9o76b7mB3AUx_hobJX1g7qnCLpX_PQFKuf7p2D1E"

// Signature types (design §0).
const (
	SigTypeProfile   = "profile"
	SigTypeEndpoints = "endpoints"
	SigTypeCore      = "core"

	HeaderSignature = "X-PowerVPN-Signature"
	HeaderSigType   = "X-PowerVPN-Sig-Type"

	signingPrefix = "powervpn-client-v1\n"
)

// ErrBadSignature means the response was not signed by the panel.
var ErrBadSignature = errors.New("POWER云 签名校验失败")

// Verifier checks a panel signature over a response body.
type Verifier interface {
	Verify(sigType string, body []byte, signature string) error
}

// SignedMessage is the exact byte string the panel signs.
func SignedMessage(sigType string, body []byte) []byte {
	msg := make([]byte, 0, len(signingPrefix)+len(sigType)+1+len(body))
	msg = append(msg, signingPrefix...)
	msg = append(msg, sigType...)
	msg = append(msg, '\n')
	return append(msg, body...)
}

type edVerifier struct{ key ed25519.PublicKey }

func (v edVerifier) Verify(sigType string, body []byte, signature string) error {
	if len(v.key) != ed25519.PublicKeySize {
		return ErrBadSignature
	}
	sig, err := decodeB64(signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return ErrBadSignature
	}
	if !ed25519.Verify(v.key, SignedMessage(sigType, body), sig) {
		return ErrBadSignature
	}
	return nil
}

// NewVerifier builds a verifier from a base64url raw Ed25519 public key (a
// 44-byte SPKI DER in base64 is accepted too).
func NewVerifier(publicKey string) (Verifier, error) {
	raw, err := decodeB64(publicKey)
	if err != nil {
		return nil, fmt.Errorf("public key: %w", err)
	}
	// SPKI DER for Ed25519 = 12-byte header + 32-byte key.
	if len(raw) == 44 {
		raw = raw[12:]
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("public key: want %d bytes, got %d", ed25519.PublicKeySize, len(raw))
	}
	return edVerifier{key: ed25519.PublicKey(raw)}, nil
}

// DefaultVerifier uses PanelPublicKey; with no key configured it rejects all.
func DefaultVerifier() Verifier {
	v, err := NewVerifier(PanelPublicKey)
	if err != nil {
		return edVerifier{}
	}
	return v
}

// VerifyResponse checks the signature headers of a panel response. The
// declared type (when present) must equal want, and the signature must cover
// want — so a signed "endpoints" body can never pass as a "profile".
func VerifyResponse(v Verifier, want string, h http.Header, body []byte) error {
	sig := strings.TrimSpace(h.Get(HeaderSignature))
	if sig == "" || v == nil {
		return ErrBadSignature
	}
	if t := strings.TrimSpace(h.Get(HeaderSigType)); t != "" && t != want {
		return ErrBadSignature
	}
	return v.Verify(want, body, sig)
}

func decodeB64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "=")
	s = strings.NewReplacer("+", "-", "/", "_").Replace(s)
	return base64.RawURLEncoding.DecodeString(s)
}
