package core

import (
	"testing"

	"proxysplit/internal/nodes"
)

func TestRemoteDNSServerUsesTCPForSocksAndHTTP(t *testing.T) {
	cases := map[string]string{"socks": "tcp", "http": "tcp", "vless": "udp", "hysteria2": "udp"}
	for typ, want := range cases {
		got := remoteDNSServer(&nodes.Node{Type: typ}, "proxy")["type"]
		if got != want {
			t.Errorf("%s node: dns-remote type = %v, want %s", typ, got, want)
		}
	}
}
