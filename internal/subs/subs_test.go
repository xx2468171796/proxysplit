package subs

import "testing"

func TestIsMetadataNode(t *testing.T) {
	for _, name := range []string{
		"剩余流量：261.61 GB",
		"套餐到期：长期有效",
		"过滤掉15条线路",
		"Traffic: 100 GB",
	} {
		if !isMetadataNode(name) {
			t.Fatalf("expected metadata node: %q", name)
		}
	}
	for _, name := range []string{"日本-优化", "香港 WAP", "US Traffic Relay"} {
		if isMetadataNode(name) {
			t.Fatalf("unexpected metadata node: %q", name)
		}
	}
}
