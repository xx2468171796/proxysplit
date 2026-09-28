package core

import (
	"bytes"
	"encoding/json"
	"testing"

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
