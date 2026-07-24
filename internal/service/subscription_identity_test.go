package service

import (
	"encoding/base64"
	"testing"

	"proxysplit/internal/nodes"
)

func TestNodeEndpointKeyMatchesVMessShareAndClash(t *testing.T) {
	raw := `{"v":"2","ps":"日本-优化","add":"edge.example.com","port":"16617","id":"eb936878-a3dd-4a79-a9d7-9337ae519bef","aid":"0","scy":"auto","net":"ws","type":"none","host":"cdn.example.com","path":"/","tls":""}`
	link := "vmess://" + base64.StdEncoding.EncodeToString([]byte(raw))
	share, err := nodes.ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	clash, err := nodes.ParseClashYAML([]byte(`
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
`))
	if err != nil {
		t.Fatal(err)
	}
	if nodeEndpointKey(share) != nodeEndpointKey(clash[0]) {
		t.Fatalf("equivalent formats produced different endpoint identities:\nshare=%+v\nclash=%+v", share, clash[0])
	}
}
