package noderesolve

import (
	"context"
	"net"
	"os"
	"testing"
)

// TestLive resolves a real domain through the real resolvers (system DNS,
// public UDP, DoH by IP, bound to the physical adapter). PS_LIVE_RESOLVE=1.
func TestLive(t *testing.T) {
	if os.Getenv("PS_LIVE_RESOLVE") == "" {
		t.Skip("set PS_LIVE_RESOLVE=1")
	}
	cfg := Config{}
	if os.Getenv("PS_LIVE_RESOLVE") == "nobind" {
		cfg.Dialer = func() *net.Dialer { return &net.Dialer{} }
	}
	r := New(cfg)
	res, err := r.Resolve(context.Background(), "www.baidu.com", 443)
	t.Log(Summary(res, err))
	for _, a := range res.Resolvers {
		t.Logf("%-28s ok=%v %4d ms ips=%v err=%s", a.Name, a.OK, a.Ms, a.IPs, a.ErrCode)
	}
	if err != nil {
		t.Fatal(err)
	}
}
