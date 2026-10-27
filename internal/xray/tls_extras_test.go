package xray

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

const extrasLink = "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@cdn.example.com:443?encryption=none&security=tls&sni=cdn.example.com&fp=chrome&type=xhttp&path=%2Fx&mode=auto" +
	"&extra=%7B%22xmux%22%3A%7B%22maxConcurrency%22%3A%2216-32%22%2C%22hMaxRequestTimes%22%3A%22600-900%22%2C%22hKeepAlivePeriod%22%3A15%2C%22cMaxReuseTimes%22%3A%22bad%22%7D%7D" +
	"&ech=AF7%2BDQBaAAAgACA51i3Ssu4wUMV4FNCc8iRX5J%2BYC4Bhigz9sacl2lCfSQAkAAEAAQABAAIAAQADAAIAAQACAAIAAgADAAMAAQADAAIAAwADAAtleGFtcGxlLmNvbQAA&echForceQuery=half" +
	"&pcs=e8e2d387fdbffeb38e9c9065cf30a97ee23c0e3d32ee6f78ffae40966befccc9#EXTRAS"

func TestTLSExtrasInConfig(t *testing.T) {
	n, err := nodes.ParseLink(extrasLink)
	if err != nil {
		t.Fatal(err)
	}
	ob, err := Outbound(n, "o")
	if err != nil {
		t.Fatal(err)
	}
	tls := ob["streamSettings"].(M)["tlsSettings"].(M)
	if tls["echConfigList"] != n.ECH || tls["echForceQuery"] != "half" || tls["pinnedPeerCertSha256"] != n.PinnedCert {
		t.Fatalf("tlsSettings = %v", tls)
	}
	raw, err := BuildConfig([]Entry{{Key: Key(n), Endpoint: Endpoint{Port: 33001, User: "u", Pass: "p"}, Node: n}}, "")
	if err != nil {
		t.Fatal(err)
	}
	bin := xrayBin(t)
	path := filepath.Join(t.TempDir(), "xray.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, "run", "-test", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("xray rejected config: %v\n%s\n%s", err, out, raw)
	}
}
