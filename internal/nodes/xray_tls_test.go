package nodes

import (
	"encoding/json"
	"testing"
)

// ECHConfigList example from the Xray docs (transports/tls.md).
const echB64 = "AF7+DQBaAAAgACA51i3Ssu4wUMV4FNCc8iRX5J+YC4Bhigz9sacl2lCfSQAkAAEAAQABAAIAAQADAAIAAQACAAIAAgADAAMAAQADAAIAAwADAAtleGFtcGxlLmNvbQAA"

const pcsHex = "e8e2d387fdbffeb38e9c9065cf30a97ee23c0e3d32ee6f78ffae40966befccc9"

func TestV2rayNLinkECHAndPinning(t *testing.T) {
	// v2rayN escapes "+" as %2B; some panels leave it raw (decodes to space).
	for _, ech := range []string{"AF7%2BDQBaAAAgACA51i3Ssu4wUMV4FNCc8iRX5J%2BYC4Bhigz9sacl2lCfSQAkAAEAAQABAAIAAQADAAIAAQACAAIAAgADAAMAAQADAAIAAwADAAtleGFtcGxlLmNvbQAA", echB64} {
		link := "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@cdn.example.com:443?encryption=none&security=tls&sni=cdn.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1&type=ws&host=cdn.example.com&path=%2Fws&ech=" + ech + "&echForceQuery=full&pcs=" + pcsHex + "%2CBAD#ECH-WS"
		n, err := ParseLink(link)
		if err != nil {
			t.Fatal(err)
		}
		if n.ECH != echB64 || n.ECHForceQuery != "full" || n.PinnedCert != pcsHex {
			t.Fatalf("ech=%q force=%q pcs=%q", n.ECH, n.ECHForceQuery, n.PinnedCert)
		}
		if !n.NeedsXray() || n.EffectiveCore() != CoreXray {
			t.Fatal("ECH / pinned node must run on Xray")
		}
	}
}

func TestTrojanPinnedCertNeedsXray(t *testing.T) {
	n, err := ParseLink("trojan://pw@tj.example.com:443?security=tls&sni=tj.example.com&type=tcp&pcs=E8:E2:D3:87:FD:BF:FE:B3:8E:9C:90:65:CF:30:A9:7E:E2:3C:0E:3D:32:EE:6F:78:FF:AE:40:96:6B:EF:CC:C9#TJ")
	if err != nil {
		t.Fatal(err)
	}
	if n.PinnedCert == "" || !n.NeedsXray() {
		t.Fatalf("colon-form pcs not taken: %+v", n)
	}
	plain, _ := ParseLink("trojan://pw@tj.example.com:443?security=tls&sni=tj.example.com#TJ2")
	if plain.NeedsXray() {
		t.Fatal("plain trojan moved to Xray")
	}
	bad, _ := ParseLink("trojan://pw@tj.example.com:443?security=tls&echForceQuery=always#TJ3")
	if bad.ECHForceQuery != "" {
		t.Fatalf("invalid echForceQuery kept: %q", bad.ECHForceQuery)
	}
}

func TestXHTTPExtraXmuxSanitized(t *testing.T) {
	extra := `{"xmux":{"maxConcurrency":"16-32","maxConnections":0,"cMaxReuseTimes":"bad","hMaxRequestTimes":"600-900","hMaxReusableSecs":"1800-3000","hKeepAlivePeriod":15,"future":true},"noGRPCHeader":true,"unknownKey":"kept"}`
	got := sanitizeExtra(extra)
	var obj map[string]map[string]any
	var flat map[string]any
	if err := json.Unmarshal([]byte(got), &flat); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(`{"x":`+mustJSON(t, flat["xmux"])+`}`), &obj)
	mux := obj["x"]
	if mux["maxConcurrency"] != "16-32" || mux["hMaxRequestTimes"] != "600-900" || mux["hKeepAlivePeriod"] != float64(15) || mux["future"] != true {
		t.Fatalf("xmux = %v", mux)
	}
	if _, ok := mux["cMaxReuseTimes"]; ok {
		t.Fatalf("bad range kept: %v", mux)
	}
	if flat["unknownKey"] != "kept" || flat["noGRPCHeader"] != true {
		t.Fatalf("extra keys lost: %s", got)
	}
	if s := sanitizeExtra(`{"xmux":"nope","mode":"x"}`); s != `{"mode":"x"}` {
		t.Fatalf("non-object xmux kept: %s", s)
	}
}

func TestClashECHOpts(t *testing.T) {
	ns, err := ParseClashYAML([]byte(`
proxies:
  - name: ech
    type: vless
    server: cdn.example.com
    port: 443
    uuid: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    tls: true
    servername: cdn.example.com
    network: ws
    ws-opts: {path: /ws}
    ech-opts: {enable: true, config: ` + echB64 + `}
`))
	if err != nil || len(ns) != 1 {
		t.Fatal(err)
	}
	if ns[0].ECH != echB64 || !ns[0].NeedsXray() {
		t.Fatalf("clash ech: %+v", ns[0])
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
