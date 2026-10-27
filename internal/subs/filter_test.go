package subs

import (
	"testing"

	"proxysplit/internal/nodes"
)

func TestFilterNodes(t *testing.T) {
	list := []*nodes.Node{{Name: "香港 01"}, {Name: "HK-02"}, {Name: "日本 01"}, {Name: "剩余流量：10G"}}
	got, err := FilterNodes(list, "香港|hk", "")
	if err != nil || len(got) != 2 {
		t.Fatalf("include: %v %v", got, err)
	}
	got, _ = FilterNodes(list, "", "流量")
	if len(got) != 3 {
		t.Fatalf("exclude: %d", len(got))
	}
	if _, err := FilterNodes(list, "(", ""); err == nil {
		t.Fatal("bad regex must error")
	}
	if got, _ := FilterNodes(list, "", ""); len(got) != 4 {
		t.Fatal("no filter keeps all")
	}
}
