package subs

import (
	"fmt"
	"regexp"
	"strings"

	"proxysplit/internal/nodes"
)

// FilterNodes keeps nodes whose name matches include (empty = all) and not
// exclude (empty = none). Both are case-insensitive regular expressions, so
// plain keywords work and "香港|HK" means either (v2rayN SubItem.Filter).
func FilterNodes(list []*nodes.Node, include, exclude string) ([]*nodes.Node, error) {
	inc, err := compileFilter(include)
	if err != nil {
		return nil, fmt.Errorf("「包含」规则写法有误：%w", err)
	}
	exc, err := compileFilter(exclude)
	if err != nil {
		return nil, fmt.Errorf("「排除」规则写法有误：%w", err)
	}
	if inc == nil && exc == nil {
		return list, nil
	}
	out := list[:0:0]
	for _, n := range list {
		if inc != nil && !inc.MatchString(n.Name) {
			continue
		}
		if exc != nil && exc.MatchString(n.Name) {
			continue
		}
		out = append(out, n)
	}
	return out, nil
}

func compileFilter(expr string) (*regexp.Regexp, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, nil
	}
	return regexp.Compile("(?i)" + expr)
}
