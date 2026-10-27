package service

import "testing"

func TestNetSettingsValidate(t *testing.T) {
	ok := NetSettings{DNSDirect: "119.29.29.29", DNSRemote: "1.1.1.1", TunMTU: 1400, Hosts: "# 注释\nnas.home 192.168.1.10\nNAS.Home. 192.168.1.11\n"}
	if err := ok.validate(); err != nil {
		t.Fatal(err)
	}
	if h := ok.coreDNS().Hosts["nas.home"]; len(h) != 2 {
		t.Fatalf("hosts = %v", h)
	}
	for _, bad := range []NetSettings{{DNSDirect: "dns.google"}, {TunMTU: 100}, {Hosts: "only-domain"}, {Hosts: "a.com 1.2.3"}} {
		if bad.validate() == nil {
			t.Fatalf("%+v must be rejected", bad)
		}
	}
	s, _ := New(t.TempDir(), t.TempDir())
	if err := s.SetNetSettings(NetSettings{TunMTU: 1400}); err != nil || s.GetSettings().Net.TunMTU != 1400 {
		t.Fatalf("save failed: %v", err)
	}
}
