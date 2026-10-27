package core

import (
	"errors"
	"fmt"

	"proxysplit/internal/nodes"
)

// errNoAutoMembers: "自动选择" was picked but no stored node can join the group.
var errNoAutoMembers = errors.New("没有可自动选择的节点")

// buildURLTestOutbounds emits an "自动选择（最快）" group (nodes.TypeURLTest):
// every member through buildNodeOutbounds as "<tag>/m<i>" (so sidecar,
// pinning and 前置代理 apply per member), then a sing-box urltest outbound
// under tag that keeps the lowest-latency live member and fails over.
func buildURLTestOutbounds(n *nodes.Node, tag string, opts Options, strict bool) ([]M, error) {
	var members []string
	var obs []M
	for i, m := range n.Members {
		if m == nil || m.Official || m.Type == nodes.TypeURLTest {
			continue // egress-restricted lines cannot hide inside a group
		}
		mtag := fmt.Sprintf("%s/m%d", tag, i)
		mobs, err := buildNodeOutbounds(m, mtag, opts, strict)
		if err != nil {
			return nil, fmt.Errorf("自动选择成员「%s」：%w", m.Name, err)
		}
		members = append(members, mtag)
		obs = append(obs, mobs...)
	}
	if len(members) == 0 {
		return nil, errNoAutoMembers
	}
	group := M{
		"type":                        "urltest",
		"tag":                         tag,
		"outbounds":                   members,
		"url":                         "https://www.gstatic.com/generate_204",
		"interval":                    "3m",
		"tolerance":                   50,
		"idle_timeout":                "30m",
		"interrupt_exist_connections": false,
	}
	return append([]M{group}, obs...), nil
}
