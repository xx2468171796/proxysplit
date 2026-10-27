package xray

import (
	"encoding/json"
	"testing"
	"time"
)

// Xray resolves node servers via its own direct resolvers (never the OS
// resolver, which TUN would hijack into the proxy) and requires the per-launch
// SOCKS credentials.
func TestBuildConfigDNSAndAuth(t *testing.T) {
	raw, err := BuildConfig(entries(t), "")
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		DNS struct {
			Servers []string `json:"servers"`
		} `json:"dns"`
		Inbounds []struct {
			Settings struct {
				Accounts []struct{ User, Pass string }
			}
		}
		Outbounds []struct {
			StreamSettings struct {
				Sockopt struct {
					DomainStrategy string `json:"domainStrategy"`
				} `json:"sockopt"`
			} `json:"streamSettings"`
		}
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.DNS.Servers) < 2 || cfg.DNS.Servers[0] != "223.5.5.5" {
		t.Fatalf("dns: %+v", cfg.DNS)
	}
	for i, in := range cfg.Inbounds {
		if len(in.Settings.Accounts) != 1 || in.Settings.Accounts[0].User != "u" || in.Settings.Accounts[0].Pass != "p" {
			t.Fatalf("inbound %d accounts: %+v", i, in.Settings)
		}
	}
	for i, ob := range cfg.Outbounds {
		if ob.StreamSettings.Sockopt.DomainStrategy != resolveStrategy {
			t.Fatalf("outbound %d sockopt: %+v", i, ob.StreamSettings)
		}
	}
	bad := entries(t)[:1]
	bad[0].Pass = ""
	if _, err := BuildConfig(bad, ""); err == nil {
		t.Fatal("entry without credentials accepted")
	}
}

// waitPort gives up as soon as the process has exited instead of waiting out
// the whole timeout.
func TestWaitPortReturnsOnExit(t *testing.T) {
	port, err := FreePort()
	if err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	close(exited)
	start := time.Now()
	if err := waitPort(port, 5*time.Second, exited); err == nil {
		t.Fatal("closed port reported up")
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("waitPort took %v after exit", d)
	}
}

func TestNewSecretIsRandom(t *testing.T) {
	a, b := newSecret(), newSecret()
	if len(a) != 32 || a == b {
		t.Fatalf("secrets %q %q", a, b)
	}
}
