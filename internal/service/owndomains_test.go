package service

import (
	"reflect"
	"testing"
)

func TestDirectDomainsIncludesOwnGateways(t *testing.T) {
	got := DirectDomains("")
	if !reflect.DeepEqual(got, []string{"zygskins.cn"}) {
		t.Fatalf("自家国内站点必须始终直连，得到 %v", got)
	}
	for _, host := range []string{"codex.demo.zygskins.cn", "sub2api.demo.zygskins.cn", "ai.zygskins.cn"} {
		if !coveredBy(host, got) {
			t.Fatalf("%s 应被直连规则覆盖", host)
		}
	}
}

func TestDirectDomainsAddsAPIHostOnce(t *testing.T) {
	if got := DirectDomains("api.example.com"); !reflect.DeepEqual(got, []string{"zygskins.cn", "api.example.com"}) {
		t.Fatalf("商业 API 主机要加进直连，得到 %v", got)
	}
	if got := DirectDomains("Pay.ZYGSKINS.cn"); len(got) != 1 {
		t.Fatalf("已被后缀覆盖的主机不重复加，得到 %v", got)
	}
}
