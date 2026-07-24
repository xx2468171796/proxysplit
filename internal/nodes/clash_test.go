package nodes

import "testing"

func TestParseClashYAMLVMessWS(t *testing.T) {
	data := []byte(`
mixed-port: 7890
proxies:
  - name: 日本-优化
    type: vmess
    server: edge.example.com
    port: 16617
    uuid: eb936878-a3dd-4a79-a9d7-9337ae519bef
    alterId: 0
    cipher: auto
    network: ws
    ws-opts:
      path: /
      headers:
        Host: cdn.example.com
`)
	got, err := ParseClashYAML(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("nodes=%d", len(got))
	}
	n := got[0]
	if n.Type != "vmess" || n.Network != "ws" || n.Host != "cdn.example.com" || n.Path != "/" || n.Cipher != "auto" {
		t.Fatalf("unexpected node: %+v", n)
	}
}

func TestParseClashYAMLReality(t *testing.T) {
	data := []byte(`
proxies:
  - name: reality
    type: vless
    server: edge.example.com
    port: 443
    uuid: eb936878-a3dd-4a79-a9d7-9337ae519bef
    tls: true
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: public-key
      short-id: abcd
`)
	got, err := ParseClashYAML(data)
	if err != nil {
		t.Fatal(err)
	}
	n := got[0]
	if n.Security != "reality" || n.PublicKey != "public-key" || n.ShortID != "abcd" || n.SNI != "www.example.com" {
		t.Fatalf("unexpected Reality node: %+v", n)
	}
}
