package telemetry

import "testing"

// Lines as the core writes them (ANSI colours stripped by Sanitize upstream
// or not — the patterns do not depend on them). Cases from 2026-10-28.
func TestConnStatsSummary(t *testing.T) {
	c := newConnStats()
	lines := []string{
		// attempt + established (second line must not count again)
		`14:59:25 INFO [2912074935 1ms] outbound/vless[proxy]: outbound connection to [2606:4700:3034::ac43:8b3a]:443`,
		`14:59:25 INFO [2912074935 0ms] outbound/vless[proxy]: outbound connection to [2606:4700:3034::ac43:8b3a]:443`,
		`14:59:26 INFO [2912074935 452ms] outbound/vless[proxy]: outbound connection to [2606:4700:3034::ac43:8b3a]:443`,
		// coloured, exactly as stored (ids wrapped in ANSI codes)
		"14:58:40 [36mINFO[0m [[38;5;224m3827658192[0m 0ms] outbound/direct[direct]: outbound packet connection to 220.181.174.34:443",
		// socks node unreachable from the user's network
		`02:40:46 INFO [3443886853 4ms] outbound/socks[proxy]: outbound connection to www.google.com:443`,
		`02:40:51 ERROR [3443886853 5.0s] connection: open connection to www.google.com:443 using outbound/socks[proxy]: dial tcp 198.87.105.21:8022: i/o timeout`,
		`02:40:56 ERROR [2156074918 5.0s] connection: open connection to www.google.com:443 using outbound/socks[proxy]: dial tcp 198.87.105.21:8022: i/o timeout`,
		`02:40:45 ERROR [542988199 1ms] connection: open connection to accel.powervpn.internal:8896 using outbound/direct[direct]: lookup accel.powervpn.internal: NXDOMAIN`,
		`ERROR [1 2ms] connection: open connection to [2606:4700::1]:443 using outbound/vless[proxy]: connection reset by peer`,
		`[service] stopped`,
	}
	for _, l := range lines {
		c.observe(l)
	}
	p, bad := c.take()
	if p == nil {
		t.Fatal("no summary")
	}
	attempts := p["attempts"].(map[string]int)
	if attempts["proxy"] != 2 || attempts["direct"] != 1 {
		t.Fatalf("attempts = %v (one per connection id)", attempts)
	}
	fails := p["failures"].(map[string]int)
	kinds := p["kinds"].(map[string]int)
	if fails["proxy"] != 3 || fails["direct"] != 1 || kinds["timeout"] != 2 || kinds["dns"] != 1 || kinds["reset"] != 1 {
		t.Fatalf("failures %v kinds %v", fails, kinds)
	}
	if p["v6Failures"] != 1 || p["failed"] != 4 {
		t.Fatalf("v6 %v failed %v", p["v6Failures"], p["failed"])
	}
	top := p["top"].([]map[string]any)
	if top[0]["dest"] != "www.google.com:443" || top[0]["n"] != 2 || top[0]["kind"] != "timeout" {
		t.Fatalf("top = %v", top)
	}
	if bad {
		t.Fatal("4 failures are below the alarm threshold")
	}
	if p2, _ := c.take(); p2 != nil {
		t.Fatal("take must reset the window")
	}
}

func TestConnStatsAlarm(t *testing.T) {
	c := newConnStats()
	for range 12 {
		c.observe(`INFO [7 0ms] outbound/vless[proxy]: outbound connection to a.example:443`)
		c.observe(`ERROR [7 5.0s] connection: open connection to a.example:443 using outbound/vless[proxy]: i/o timeout`)
	}
	if _, bad := c.take(); !bad {
		t.Fatal("12 of 12 failed must flag the window")
	}
}
