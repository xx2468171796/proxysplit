package core

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"proxysplit/internal/nodes"
)

// 仅接管选中程序 (process-only capture): instead of a TUN inbound, sing-box gets
// one loopback mixed inbound per app group; internal/capture diverts only the
// listed programs' packets with WinDivert and relays them into their group's
// inbound. Every rule that matched a process (app rule-sets, per-target app
// rules) is rewritten to match the inbound instead, so the rule order and
// outbounds stay exactly those of BuildTUNConfig.

// ProcessCapture selects process-only capture; Ports maps each inbound tag
// from ProcessInbounds to its loopback port.
type ProcessCapture struct {
	Ports map[string]int
}

const processDefaultInbound = "in-default"

// processScopedInbound is the dedicated inbound of a program that has
// per-target rules (they need to tell it apart from the rest of its group).
func processScopedInbound(name string) string {
	sum := sha1.Sum([]byte(strings.ToLower(strings.TrimSpace(name))))
	return "in-s-" + hex.EncodeToString(sum[:5])
}

func processGroupInbound(setTag string) string { return "in-" + setTag }

// scopedNames returns the distinct (lower-case) programs with per-target rules.
func scopedNames(opts Options) map[string]bool {
	out := map[string]bool{}
	for _, sc := range opts.SplitScoped {
		if n := strings.ToLower(strings.TrimSpace(sc.Name)); n != "" {
			out[n] = true
		}
	}
	return out
}

// ProcessInbounds lists the inbound tags a process-capture config needs
// (sorted). Moving apps between existing groups does not change it.
func ProcessInbounds(opts Options) []string {
	var tags []string
	for _, t := range splitGroupTags(opts) {
		tags = append(tags, processGroupInbound(t))
	}
	for n := range scopedNames(opts) {
		tags = append(tags, processScopedInbound(n))
	}
	if !opts.SplitWhitelist {
		tags = append(tags, processDefaultInbound)
	}
	sort.Strings(tags)
	return tags
}

// processRewrite holds the process -> inbound mapping used to rewrite rules.
type processRewrite struct {
	sets    map[string][]string // app rule-set tag -> inbounds
	names   map[string]string   // process_name (lower) -> inbound
	regexes map[string]string   // process_path_regex -> inbound
}

func newProcessRewrite(opts Options) processRewrite {
	scoped := scopedNames(opts)
	rw := processRewrite{sets: map[string][]string{appSetBlock: nil}, names: map[string]string{}, regexes: map[string]string{}}
	for n := range scoped {
		in := processScopedInbound(n)
		if d, ok := strings.CutPrefix(n, DirPrefix); ok {
			rw.regexes[DirRegex(d)] = in
		} else {
			rw.names[n] = in
		}
	}
	members := func(names []string) []string {
		var ins []string
		for _, n := range names {
			if scoped[strings.ToLower(strings.TrimSpace(n))] {
				ins = append(ins, processScopedInbound(n))
			}
		}
		return ins
	}
	rw.sets[appSetDirect] = members(opts.SplitDirect)
	for i, tag := range splitGroupTags(opts) {
		rw.sets[tag] = append([]string{processGroupInbound(tag)}, members(opts.SplitGroups[i].Names)...)
	}
	return rw
}

// rule rewrites one route rule; ok=false drops it (it can never match).
func (rw processRewrite) rule(r M) (M, bool) {
	out := cloneMatch(r)
	if subs, isList := r["rules"].([]M); isList {
		next := make([]M, 0, len(subs))
		for _, s := range subs {
			ns, ok := rw.rule(s)
			if !ok {
				return nil, false // logical AND with an impossible member
			}
			next = append(next, ns)
		}
		out["rules"] = next
	}
	var inbounds []string
	matched := false
	if sets, ok := r["rule_set"].([]string); ok {
		var keep []string
		for _, t := range sets {
			if ins, isApp := rw.sets[t]; isApp {
				matched = true
				inbounds = append(inbounds, ins...)
			} else {
				keep = append(keep, t)
			}
		}
		if matched {
			delete(out, "rule_set")
			if len(keep) > 0 {
				out["rule_set"] = keep
			}
		}
	}
	for key, table := range map[string]map[string]string{"process_name": rw.names, "process_path_regex": rw.regexes} {
		if vals, ok := r[key].([]string); ok {
			matched = true
			delete(out, key)
			for _, v := range vals {
				if key == "process_name" {
					v = strings.ToLower(v)
				}
				if in := table[v]; in != "" {
					inbounds = append(inbounds, in)
				}
			}
		}
	}
	if _, ok := r["process_path"]; ok {
		return nil, false // 端口代理 core / xray: excluded in ProcessRoutes (processPathDirect)
	}
	if matched {
		if len(inbounds) == 0 {
			return nil, false
		}
		out["inbound"] = inbounds
	}
	return out, true
}

// BuildProcessConfig builds the process-capture config: BuildTUNConfig's rules
// and outbounds with mixed inbounds instead of the TUN.
func BuildProcessConfig(node *nodes.Node, logLevel string, opts Options) ([]byte, error) {
	if !opts.Split || opts.Process == nil {
		return nil, fmt.Errorf("process capture needs app-split options")
	}
	tree, err := buildTUNTree(node, logLevel, opts)
	if err != nil {
		return nil, err
	}
	var inbounds []M
	for _, in := range tree.Inbounds {
		if in["type"] != "tun" {
			inbounds = append(inbounds, in)
		}
	}
	for _, tag := range ProcessInbounds(opts) {
		port := opts.Process.Ports[tag]
		if port <= 0 {
			return nil, fmt.Errorf("no port for inbound %s", tag)
		}
		inbounds = append(inbounds, M{"type": "mixed", "tag": tag, "listen": "127.0.0.1", "listen_port": port})
	}
	tree.Inbounds = inbounds
	rw := newProcessRewrite(opts)
	var rules []M
	for _, r := range tree.Rules {
		if nr, ok := rw.rule(r); ok {
			rules = append(rules, nr)
		}
	}
	tree.Rules = rules
	var sets []M
	for _, s := range tree.RuleSets {
		tag, _ := s["tag"].(string)
		if _, isApp := rw.sets[tag]; !isApp {
			sets = append(sets, s)
		}
	}
	tree.RuleSets = sets
	return json.MarshalIndent(tree.root(), "", "  ")
}
