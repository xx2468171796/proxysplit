package core

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

func TestRawOutboundsVerbatimWithPrefixedTags(t *testing.T) {
	raws := []json.RawMessage{
		json.RawMessage(`{"tag":"A","type":"urltest","outbounds":["A-mux","A-compat"],"interval":"3m"}`),
		json.RawMessage(`{"tag":"A-mux","type":"vless","server":"s","server_port":443,"uuid":"u","multiplex":{"enabled":true,"brutal":{"enabled":true,"up_mbps":50,"down_mbps":12345678901}}}`),
		json.RawMessage(`{"tag":"A-compat","type":"vless","server":"s","server_port":443,"uuid":"u","flow":"xtls-rprx-vision","detour":"direct"}`),
	}
	n := &nodes.Node{ID: "pv-1", Name: "A", Official: true, EntryTag: "A", Outbounds: raws}
	cfg, err := BuildConfig(n, 17890, "info", Options{RouteMode: RouteGlobal})
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Outbounds []map[string]any `json:"outbounds"`
	}
	dec := json.NewDecoder(bytesReader(cfg))
	dec.UseNumber()
	if err := dec.Decode(&doc); err != nil {
		t.Fatal(err)
	}
	byTag := map[string]map[string]any{}
	for _, o := range doc.Outbounds {
		byTag[o["tag"].(string)] = o
	}
	entry := byTag["node-pv-1"]
	if entry == nil || entry["type"] != "urltest" {
		t.Fatalf("entry missing: %v", doc.Outbounds)
	}
	members := entry["outbounds"].([]any)
	if members[0] != "node-pv-1/A-mux" || members[1] != "node-pv-1/A-compat" {
		t.Fatalf("members not renamed: %v", members)
	}
	mux := byTag["node-pv-1/A-mux"]["multiplex"].(map[string]any)["brutal"].(map[string]any)
	if mux["down_mbps"].(json.Number).String() != "12345678901" {
		t.Fatalf("params rewritten: %v", mux)
	}
	compat := byTag["node-pv-1/A-compat"]
	if compat["flow"] != "xtls-rprx-vision" || compat["detour"] != "direct" {
		t.Fatalf("compat changed: %v", compat)
	}
}

func TestCompatMultiplexAndSSPlugin(t *testing.T) {
	n := &nodes.Node{ID: "x", Type: "shadowsocks", Server: "s", Port: 8388, Method: "aes-128-gcm", Password: "p",
		Plugin: "obfs-local", PluginOpts: "obfs=http;obfs-host=a.com", Multiplex: map[string]any{"enabled": true, "protocol": "smux"}}
	obs, err := buildOutbounds(n, "t")
	if err != nil || len(obs) != 1 {
		t.Fatal(err)
	}
	if obs[0]["plugin"] != "obfs-local" || obs[0]["plugin_opts"] != "obfs=http;obfs-host=a.com" || obs[0]["multiplex"] == nil {
		t.Fatalf("got %v", obs[0])
	}
}

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func TestRawOutboundsRejectForeignRefsAndKeepSource(t *testing.T) {
	src := `{"tag":"A","type":"vless","server":"s","server_port":443,"uuid":"u","detour":"B"}`
	n := &nodes.Node{ID: "r", Name: "A", EntryTag: "A", Outbounds: []json.RawMessage{json.RawMessage(src)}}
	// "B" is not part of the node: it must not bind to another outbound.
	if _, err := buildOutbounds(n, "node-r"); err == nil {
		t.Fatal("unknown detour accepted")
	}
	ok := `{"tag":"A","type":"selector","outbounds":["A1"],"default":"A1"}`
	m := &nodes.Node{ID: "s", Name: "A", EntryTag: "A", Outbounds: []json.RawMessage{json.RawMessage(ok), json.RawMessage(`{"tag":"A1","type":"vless","server":"s","server_port":1,"uuid":"u"}`)}}
	obs, err := buildOutbounds(m, "node-s")
	if err != nil || obs[0]["default"] != "node-s/A1" {
		t.Fatalf("%v %v", obs, err)
	}
	if string(m.Outbounds[0]) != ok {
		t.Fatal("source outbound mutated")
	}
}

func TestCompatMultiplexSkippedForVision(t *testing.T) {
	n := &nodes.Node{ID: "v", Type: "vless", Server: "s", Port: 443, UUID: "u", Flow: "xtls-rprx-vision", Security: "tls",
		Multiplex: map[string]any{"enabled": true}}
	obs, err := buildOutbounds(n, "t")
	if err != nil || obs[0]["multiplex"] != nil {
		t.Fatalf("%v %v", obs, err)
	}
}

// Audit fix: a third-party sing-box config imported as-is must not stop the
// embedded core from starting because of fields that only mean something on
// the author's machine (their DNS server tags, files, legacy options).
func TestForeignSingboxOutboundsStartTheCore(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	ca := filepath.Join(dir, "ca.pem")
	os.WriteFile(ca, selfSignedPEM(t), 0o600)
	caJSON, _ := json.Marshal(ca)
	body := []byte(`{
  "dns": {"servers": [{"type": "https", "tag": "their-dns", "server": "1.1.1.1"}]},
  "outbounds": [
    {"type": "vless", "tag": "HK", "server": "hk.example.com", "server_port": 443, "uuid": "b831381d-6324-4d53-ad4f-8cda48b30811",
     "domain_resolver": {"server": "their-dns", "strategy": "ipv4_only"}, "domain_strategy": "prefer_ipv4", "routing_mark": 255,
     "bind_interface": "their-eth0",
     "tls": {"enabled": true, "server_name": "hk.example.com", "certificate_path": "/etc/their/ca.pem",
             "ech": {"enabled": true, "config_path": "/etc/their/ech.pem"}}},
    {"type": "trojan", "tag": "JP", "server": "jp.example.com", "server_port": 443, "password": "p", "domain_resolver": "their-dns",
     "tls": {"enabled": true, "server_name": "jp.example.com", "certificate_path": ` + string(caJSON) + `}},
    {"type": "wireguard", "tag": "WG", "server": "wg.example.com", "server_port": 51820, "local_address": ["10.0.0.2/32"],
     "private_key": "YNXtAzepDqRv9H52osJVDQnznT5AM11eCK3ESpwSt04=", "peer_public_key": "Z1XXLsKYkYxuiYjJIkRvtIKFepCYHTgON+GwPq7SOV4="},
    {"type": "direct", "tag": "direct"}
  ]
}`)
	list, err := nodes.ParseSingboxJSON(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want HK + JP (legacy wireguard outbound skipped: the 1.13+ core rejects it), got %d", len(list))
	}
	for _, n := range list {
		cfg, err := BuildConfig(n, 17890, "info", Options{RemoteDNS: true, RouteMode: RouteGlobal})
		if err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(dir, n.Name+".json")
		os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("core refuses imported node %s:\n%s\n%s", n.Name, out, cfg)
		}
		obs, _ := buildOutbounds(n, "node-x")
		switch n.Name {
		case "HK":
			for _, k := range []string{"domain_resolver", "domain_strategy", "routing_mark", "bind_interface"} {
				if _, ok := obs[0][k]; ok {
					t.Fatalf("%s kept: %v", k, obs[0])
				}
			}
			tls := obs[0]["tls"].(map[string]any)
			if _, ok := tls["certificate_path"]; ok {
				t.Fatal("missing certificate file kept")
			}
			if tls["server_name"] != "hk.example.com" || obs[0]["uuid"] != "b831381d-6324-4d53-ad4f-8cda48b30811" {
				t.Fatalf("other params changed: %v", obs[0])
			}
		case "JP":
			if obs[0]["tls"].(map[string]any)["certificate_path"] != ca {
				t.Fatal("a certificate file present on this machine must be kept")
			}
		}
		if !bytes.Contains(n.Outbounds[0], []byte("domain_resolver")) {
			t.Fatal("stored source outbound must stay verbatim")
		}
	}

	// Signed POWER云 outbounds are passed through untouched.
	off := &nodes.Node{ID: "pv", Name: "A", Official: true, EntryTag: "A", Outbounds: []json.RawMessage{
		json.RawMessage(`{"tag":"A","type":"vless","server":"s","server_port":443,"uuid":"u","bind_interface":"x"}`)}}
	obs, err := buildOutbounds(off, "node-pv")
	if err != nil || obs[0]["bind_interface"] != "x" {
		t.Fatalf("official outbound changed: %v %v", obs, err)
	}
}

func selfSignedPEM(t *testing.T) []byte {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}
