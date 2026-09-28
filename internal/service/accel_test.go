package service

import (
	"testing"

	"proxysplit/internal/core"
)

func TestClaudeOutboundFollowsClaudeLine(t *testing.T) {
	cases := []struct {
		name string
		opts core.Options
		want string
	}{
		{"列在某条线路", core.Options{SplitWhitelist: true, SplitGroups: []core.SplitGroup{{Names: []string{"Claude.exe"}, NodeTag: "node-tw"}}}, "node-tw"},
		{"npm 版跑在 node.exe", core.Options{SplitWhitelist: true, SplitGroups: []core.SplitGroup{{Names: []string{"node.exe"}, NodeTag: "proxy"}}}, "proxy"},
		{"设成直连", core.Options{SplitWhitelist: true, SplitDirect: []string{"claude.exe"}}, "direct"},
		{"被拦截", core.Options{SplitBlock: []string{"claude.exe"}}, "direct"},
		{"白名单没列", core.Options{SplitWhitelist: true}, "direct"},
		{"黑名单默认线路", core.Options{SplitDefault: &core.SplitGroup{NodeTag: "node-us"}}, "node-us"},
		{"黑名单无默认", core.Options{}, "proxy"},
	}
	for _, c := range cases {
		if got := claudeOutbound(&c.opts); got != c.want {
			t.Errorf("%s：%s，应为 %s", c.name, got, c.want)
		}
	}
}
