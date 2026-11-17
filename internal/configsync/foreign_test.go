package configsync

import (
	"encoding/json"
	"strings"
	"testing"
)

// bundleOf builds a bundle by hand, the way a forged share code / file would.
func bundleOf(t *testing.T, sections map[string]string) Bundle {
	t.Helper()
	b := Bundle{Schema: Schema, App: AppTag, Sections: map[string]json.RawMessage{}}
	for sec, raw := range sections {
		if !json.Valid([]byte(raw)) {
			t.Fatalf("section %s is not JSON", sec)
		}
		b.Sections[sec] = json.RawMessage(raw)
	}
	return b
}

func nodeIDs(cfg obj) map[string]obj {
	out := map[string]obj{}
	for _, n := range list(cfg["nodes"]) {
		out[str(n, "id")] = n
	}
	return out
}

const localConfig = `{
  "nodes": [
    {"id":"own","name":"POWER云 台湾","type":"vless","server":"own.example","port":443,"official":true,"accountId":"acc","officialKey":"acc/relay:1","egress":{"mode":"ai_only"}},
    {"id":"ownsub","name":"POWER云 日本","type":"vless","server":"jp.example","port":443,"subId":"subP"}
  ],
  "selectedId": "own",
  "subs": [{"id":"subP","name":"POWER云","url":"powervpn://profile","autoUpdate":true}],
  "proxyPorts": [{"id":"pp","name":"浏览器","port":7891,"lan":true,"user":"local-user","pass":"local-port-pass","node":"own"}],
  "settings": {"theme":"light","lanShare":true,"lanUser":"local-lan","lanPass":"local-lan-pass","lanPort":7890},
  "apiToken": "keep-me"
}`

// A bundle is someone else's data (share code, cloud profile, file). Nodes in
// it must not be able to pass as this account's POWER云 lines: those are
// trusted (raw outbounds passed to the core untouched, egress policy applied,
// matched by officialKey on refresh) and never travel in a bundle.
func TestImportDropsNodesClaimingToBeAccountLines(t *testing.T) {
	forged := bundleOf(t, map[string]string{
		SecNodes: `{"nodes":[
			{"id":"ok","name":"plain","type":"trojan","server":"a.example","port":443,"password":"pw"},
			{"id":"group","name":"my sing-box group","type":"vless","server":"g.example","port":443,"entryTag":"g","outbounds":[{"type":"vless","tag":"g","server":"g.example"}]},
			{"id":"f1","name":"fake official","type":"vless","server":"evil.example","port":443,"official":true,"outbounds":[{"type":"direct","tag":"x"}]},
			{"id":"f2","name":"fake account","type":"vless","server":"evil.example","port":443,"accountId":"acc"},
			{"id":"f3","name":"fake key","type":"vless","server":"evil.example","port":443,"officialKey":"acc/relay:1"},
			{"id":"f4","name":"fake egress","type":"vless","server":"evil.example","port":443,"egress":{"mode":"ai_only"}},
			{"id":"f5","name":"rides the local POWER云 sub","type":"vless","server":"evil.example","port":443,"subId":"subP"},
			{"id":"own","name":"shadows the local line","type":"vless","server":"evil.example","port":443}
		],"selectedId":"f1"}`,
		SecSubs: `{"subs":[
			{"id":"subA","name":"A","url":"https://a.example/sub"},
			{"id":"subX","name":"fake POWER云","url":"powervpn://profile"},
			{"id":"subP","name":"collides with the local POWER云 sub","url":"https://evil.example/sub"}
		],"nodes":[
			{"id":"s1","name":"from sub","type":"trojan","server":"s.example","port":443,"subId":"subA"},
			{"id":"s2","name":"from the fake sub","type":"vless","server":"evil.example","port":443,"subId":"subX"},
			{"id":"s3","name":"from the colliding sub","type":"vless","server":"evil.example","port":443,"subId":"subP"},
			{"id":"s4","name":"no sub at all","type":"vless","server":"evil.example","port":443},
			{"id":"s5","name":"official from sub","type":"vless","server":"evil.example","port":443,"subId":"subA","official":true}
		]}`,
	})
	merged, err := Merge(localConfig, forged, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(merged, "evil.example") {
		t.Fatalf("a forged node or subscription survived the import:\n%s", merged)
	}
	cfg, _ := decodeConfig(merged)
	nodes := nodeIDs(cfg)
	for _, id := range []string{"ok", "group", "s1", "own", "ownsub"} {
		if nodes[id] == nil {
			t.Fatalf("node %s is missing after the import", id)
		}
	}
	// The user's own sing-box group keeps its raw outbounds (they are
	// neutralised when the core config is built, because it is not official).
	if nodes["group"]["outbounds"] == nil {
		t.Fatal("a non-official raw node lost its outbounds")
	}
	// This machine's POWER云 line is untouched and still the selected one.
	if own := nodes["own"]; str(own, "server") != "own.example" || own["official"] != true || str(own, "officialKey") != "acc/relay:1" {
		t.Fatalf("local account line was replaced: %v", own)
	}
	if str(cfg, "selectedId") != "own" {
		t.Fatalf("selection moved to %q", str(cfg, "selectedId"))
	}
	var subURLs []string
	for _, s := range list(cfg["subs"]) {
		subURLs = append(subURLs, str(s, "id")+"="+str(s, "url"))
	}
	if got := strings.Join(subURLs, " "); got != "subA=https://a.example/sub subP=powervpn://profile" {
		t.Fatalf("subscriptions after import: %s", got)
	}
}

// Exported bundles end up in files, cloud profiles and share codes. LAN proxy
// exposure and credentials (LAN share, port proxies) and the control token
// belong to the machine and are never in them.
func TestSnapshotNeverCarriesLanCredentialsOrControlToken(t *testing.T) {
	b, err := Snapshot(&memStore{cfg: localConfig}, "pc")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := b.Encode()
	for _, leak := range []string{"local-lan", "local-lan-pass", "local-user", "local-port-pass", "keep-me", "lanUser", "lanPass", "lanShare", `"user"`, `"pass"`, `"lan"`} {
		if strings.Contains(raw, leak) {
			t.Fatalf("bundle carries %s:\n%s", leak, raw)
		}
	}
	// The rest of both sections still travels.
	if !strings.Contains(raw, `"lanPort"`) || !strings.Contains(raw, `"theme"`) || !strings.Contains(raw, "7891") {
		t.Fatalf("portable settings / ports are missing:\n%s", raw)
	}
	// Building the bundle must not edit the live config object.
	if !strings.Contains(localConfig, "local-lan-pass") {
		t.Fatal("fixture changed")
	}
}

// An import can never switch LAN exposure on or set its credentials: with a
// forged bundle that would open an unauthenticated (or attacker-known) proxy
// on the user's network.
func TestImportKeepsThisMachinesLanExposure(t *testing.T) {
	forged := bundleOf(t, map[string]string{
		SecSettings: `{"settings":{"theme":"dark","lanShare":true,"lanUser":"","lanPass":"","lanPort":9999}}`,
		SecProxyPorts: `{"proxyPorts":[
			{"id":"pp","name":"浏览器","port":7999,"lan":true,"user":"","pass":""},
			{"id":"new","name":"new port","port":7998,"lan":true,"user":"attacker","pass":"known"}
		]}`,
	})
	merged, err := Merge(localConfig, forged, nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := decodeConfig(merged)
	set, _ := cfg["settings"].(obj)
	if set["lanShare"] != true || str(set, "lanUser") != "local-lan" || str(set, "lanPass") != "local-lan-pass" {
		t.Fatalf("LAN share of this machine changed: %v", set)
	}
	if str(set, "theme") != "dark" || set["lanPort"] != float64(9999) {
		t.Fatalf("portable settings were not imported: %v", set)
	}
	ports := map[string]obj{}
	for _, p := range list(cfg["proxyPorts"]) {
		ports[str(p, "id")] = p
	}
	if pp := ports["pp"]; pp["lan"] != true || str(pp, "user") != "local-user" || str(pp, "pass") != "local-port-pass" || pp["port"] != float64(7999) {
		t.Fatalf("existing port lost its local exposure / credentials: %v", pp)
	}
	if np := ports["new"]; np == nil || np["lan"] != nil || np["user"] != nil || np["pass"] != nil {
		t.Fatalf("a new port arrived exposed or with credentials: %v", np)
	}

	// A machine with LAN sharing off stays off.
	off := strings.Replace(localConfig, `"lanShare":true,"lanUser":"local-lan","lanPass":"local-lan-pass",`, ``, 1)
	merged, err = Merge(off, forged, nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ = decodeConfig(merged)
	if set, _ := cfg["settings"].(obj); set["lanShare"] != nil || set["lanUser"] != nil || set["lanPass"] != nil {
		t.Fatalf("import switched LAN sharing on: %v", set)
	}
}

// A copy stored by an older client still carries the machine-local keys; it
// must compare equal to the same config exported now, or every upgraded
// computer would report a sync conflict.
func TestHashIgnoresMachineLocalKeys(t *testing.T) {
	now, err := Snapshot(&memStore{cfg: localConfig}, "pc")
	if err != nil {
		t.Fatal(err)
	}
	old := bundleOf(t, map[string]string{})
	for sec, raw := range now.Sections {
		old.Sections[sec] = raw
	}
	old.Sections[SecSettings] = json.RawMessage(`{"settings":{"theme":"light","lanShare":true,"lanUser":"other","lanPass":"other-pass","lanPort":7890}}`)
	old.Sections[SecProxyPorts] = json.RawMessage(`{"proxyPorts":[{"id":"pp","name":"浏览器","port":7891,"lan":false,"user":"u","pass":"p","node":"own"}]}`)
	if now.Hash() != old.Hash() {
		t.Fatal("machine-local keys change the bundle hash")
	}
	old.Sections[SecSettings] = json.RawMessage(`{"settings":{"theme":"dark","lanPort":7890}}`)
	if now.Hash() == old.Hash() {
		t.Fatal("a real settings change no longer changes the hash")
	}
}
