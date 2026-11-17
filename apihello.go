package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
)

// How the --mcp bridge knows that whatever listens on the control port is
// this app before it sends the control token there. The port is fixed and any
// local program can bind it while the app is not running, so "something
// answers on 18088" proves nothing.
//
// When its listener is up the app publishes port + pid + a random nonce in the
// data dir (readable by this user only, like the token itself). The bridge
// checks that the pid is alive and asks the listener to prove it knows the
// nonce: GET /api/hello?challenge=<random> answers HMAC(nonce, challenge).
// The nonce never travels, so a program that cannot read the data dir cannot
// answer — and it is exactly such a program that must not get the token.

const controlEndpointFile = "control-api.json"

// controlEndpoint is the published description of the running control API.
type controlEndpoint struct {
	Port  int    `json:"port"`
	PID   int    `json:"pid"`
	Nonce string `json:"nonce"`
}

func controlEndpointPath(dir string) string { return filepath.Join(dir, controlEndpointFile) }

// publishControlEndpoint writes a fresh endpoint description for this process.
func publishControlEndpoint(dir string, port int) (controlEndpoint, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return controlEndpoint{}, err
	}
	ep := controlEndpoint{Port: port, PID: os.Getpid(), Nonce: hex.EncodeToString(secret)}
	raw, err := json.Marshal(ep)
	if err != nil {
		return controlEndpoint{}, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return controlEndpoint{}, err
	}
	path := controlEndpointPath(dir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return controlEndpoint{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return controlEndpoint{}, err
	}
	return ep, nil
}

// retractControlEndpoint removes the description: the control API of this
// process is not (or no longer) listening.
func retractControlEndpoint(dir string) { _ = os.Remove(controlEndpointPath(dir)) }

func readControlEndpoint(dir string) (controlEndpoint, error) {
	var ep controlEndpoint
	raw, err := os.ReadFile(controlEndpointPath(dir))
	if err != nil {
		return ep, err
	}
	if err := json.Unmarshal(raw, &ep); err != nil {
		return ep, err
	}
	if ep.Port <= 0 || ep.Port > 65535 || ep.PID <= 0 || len(ep.Nonce) < 32 {
		return ep, errors.New("control endpoint file is incomplete")
	}
	return ep, nil
}

// helloChallengeOK bounds the challenge: 16–64 random bytes in hex.
func helloChallengeOK(challenge string) bool {
	if len(challenge) < 32 || len(challenge) > 128 {
		return false
	}
	_, err := hex.DecodeString(challenge)
	return err == nil
}

// helloProof is HMAC-SHA256(nonce, "proxysplit-hello" 0x00 challenge) in hex.
func helloProof(nonce, challenge string) string {
	mac := hmac.New(sha256.New, []byte(nonce))
	mac.Write([]byte("proxysplit-hello\x00" + challenge))
	return hex.EncodeToString(mac.Sum(nil))
}

func helloProofValid(nonce, challenge, proof string) bool {
	return nonce != "" && hmac.Equal([]byte(helloProof(nonce, challenge)), []byte(proof))
}

// helloRoute is the one unauthenticated path: it reveals nothing but the proof.
func (a *App) helloRoute() controlRoute {
	return controlRoute{path: "/api/hello", open: true, get: func(w http.ResponseWriter, r *http.Request) {
		challenge := r.URL.Query().Get("challenge")
		if a.apiNonce == "" || !helloChallengeOK(challenge) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "GET /api/hello?challenge=<32–128 hex characters>"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"app": "proxysplit", "proof": helloProof(a.apiNonce, challenge)})
	}}
}
