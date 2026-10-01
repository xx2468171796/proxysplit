package coreupdate

import "testing"

func TestParseVersionTags(t *testing.T) {
	out := "sing-box version 1.14.2\r\n\r\nEnvironment: go1.26.8 windows/amd64\r\nTags: with_gvisor,with_utls,with_v2ray_api,relayops_prefer_first,relayops_reality_hybrid\r\nRevision: af6e64c\r\n"
	tags := parseVersionTags(out)
	if len(tags) != 5 || tags[4] != RealityHybridTag {
		t.Fatalf("tags: %v", tags)
	}
	if got := parseVersionTags("sing-box version 1.14.2\nTags: with_utls,relayops_sniff_override\n"); len(got) != 2 || got[1] == RealityHybridTag {
		t.Fatalf("r8 tags: %v", got)
	}
	if parseVersionTags("garbage") != nil {
		t.Fatal("no Tags line must give nil")
	}
}
