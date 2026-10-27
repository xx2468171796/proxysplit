package nodes

import "testing"

const wgPriv = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk="
const wgPub = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg="

func TestParseWireGuardLink(t *testing.T) {
	n, err := ParseLink("wireguard://" + "yAnz5TF%2BlXXJte14tji3zlMNq%2Bhd2rYUIgJBgB3fBmk%3D" + "@162.159.192.1:2408?publickey=" + "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg%3D" + "&address=172.16.0.2,fd01::2/128&reserved=1,2,3&mtu=1280#WARP")
	if err != nil {
		t.Fatal(err)
	}
	if n.Type != "wireguard" || n.Password != wgPriv || n.PublicKey != wgPub || n.Name != "WARP" || n.WGMTU != 1280 {
		t.Fatalf("node = %+v", n)
	}
	if n.WGAddress[0] != "172.16.0.2/32" || n.WGAddress[1] != "fd01::2/128" || len(n.WGReserved) != 3 {
		t.Fatalf("address / reserved = %v %v", n.WGAddress, n.WGReserved)
	}
	if _, err := ParseLink("wireguard://" + "k@1.2.3.4:51820?address=10.0.0.2/32"); err == nil {
		t.Fatal("missing peer key must fail")
	}
}

func TestParseWireGuardConf(t *testing.T) {
	conf := "[Interface]\r\nPrivateKey = " + wgPriv + "\r\nAddress = 10.8.0.2/24, fd00::2/64\r\nDNS = 1.1.1.1\r\nMTU = 1420\r\n\r\n[Peer]\r\nPublicKey = " + wgPub + "\r\nPresharedKey = " + wgPub + "\r\nAllowedIPs = 0.0.0.0/0\r\nEndpoint = vpn.example.org:51820 # home\r\n"
	got, skipped := ParseMany(conf)
	if skipped != 0 || len(got) != 1 {
		t.Fatalf("got %d skipped %d", len(got), skipped)
	}
	n := got[0]
	if n.Server != "vpn.example.org" || n.Port != 51820 || n.Password != wgPriv || n.WGPreShared != wgPub || n.WGMTU != 1420 || len(n.WGAddress) != 2 {
		t.Fatalf("node = %+v", n)
	}
}

// Review 2026-10-28: unescaped base64 keys ("+" and "/") still parse.
func TestParseWireGuardRawKeys(t *testing.T) {
	n, err := ParseLink("wireguard://ab/c+d=@1.2.3.4:51820?publickey=" + wgPub + "&address=10.0.0.2")
	if err != nil {
		t.Fatal(err)
	}
	if n.Password != "ab/c+d=" || n.PublicKey != wgPub || n.Server != "1.2.3.4" {
		t.Fatalf("node = %+v", n)
	}
}
