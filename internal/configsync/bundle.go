// Package configsync builds and applies the portable ProxySplit config
// bundle used by local export / import, member cloud sync, named cloud
// profiles and share codes.
//
// Bundle format (schema 1):
//
//	{schema:1, app:"proxysplit", exportedAt, device,
//	 sections:{nodes, subscriptions, rules, proxyPorts, settings}}
//
// A bundle never contains the login session (license.dat lives elsewhere),
// device fingerprints, core caches, logs, the local AI-control API token, or
// POWER云 official lines / the POWER云 profile subscription: those belong to
// the signed-in account and this machine, not to the config.
package configsync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	Schema = 1
	AppTag = "proxysplit"

	SecNodes      = "nodes"
	SecSubs       = "subscriptions"
	SecRules      = "rules"
	SecProxyPorts = "proxyPorts"
	SecSettings   = "settings"

	// officialSubURL is powervpn.ProfileSubURL (kept literal to avoid pulling
	// the POWER云 client into this pure package; a test pins the value).
	officialSubURL = "powervpn://profile"
)

// AllSections in display order.
var AllSections = []string{SecNodes, SecSubs, SecRules, SecProxyPorts, SecSettings}

// sectionKeys maps each section to the config.json keys it owns (nodes and
// subscriptions share "nodes" and are split by subId, see split).
var sectionKeys = map[string][]string{
	SecRules:      {"rules", "lines", "ruleMode", "defaultLine", "routing", "customRules", "ruleSets", "customApps"},
	SecProxyPorts: {"proxyPorts"},
	SecSettings:   {"settings", "logLevel", "clashMode"},
}

// volatileNodeKeys are runtime measurements / derived data, not config.
var volatileNodeKeys = []string{"latency", "tcpLatency", "speed", "coreInfo"}

// Bundle is the portable config package.
type Bundle struct {
	Schema     int                        `json:"schema"`
	App        string                     `json:"app"`
	ExportedAt string                     `json:"exportedAt"`
	Device     string                     `json:"device"`
	Sections   map[string]json.RawMessage `json:"sections"`
}

type obj = map[string]any

// Store is the live config (service.Service ExportAll / ImportAll).
type Store interface {
	ExportAll() (string, error)
	ImportAll(data string) error
}

func decodeConfig(raw string) (obj, error) {
	var cfg obj
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil || cfg == nil {
		return nil, errors.New("配置内容无法读取")
	}
	return cfg, nil
}

func list(v any) []obj {
	arr, _ := v.([]any)
	out := make([]obj, 0, len(arr))
	for _, it := range arr {
		if m, ok := it.(obj); ok {
			out = append(out, m)
		}
	}
	return out
}

func str(m obj, key string) string { s, _ := m[key].(string); return s }

func toAny(items []obj) []any {
	out := make([]any, len(items))
	for i, it := range items {
		out[i] = it
	}
	return out
}

// officialSubIDs returns the ids of POWER云 profile subscriptions.
func officialSubIDs(cfg obj) map[string]bool {
	ids := map[string]bool{}
	for _, s := range list(cfg["subs"]) {
		if str(s, "url") == officialSubURL {
			ids[str(s, "id")] = true
		}
	}
	return ids
}

// isAccountNode: POWER云 lines belong to the signed-in account.
func isAccountNode(n obj, officialSubs map[string]bool) bool {
	official, _ := n["official"].(bool)
	return official || officialSubs[str(n, "subId")] || str(n, "accountId") != ""
}

// split sorts the config's nodes into user nodes (manual / share links),
// subscription nodes and account (POWER云) nodes.
func split(cfg obj) (manual, subNodes, account []obj) {
	officialSubs := officialSubIDs(cfg)
	for _, n := range list(cfg["nodes"]) {
		switch {
		case isAccountNode(n, officialSubs):
			account = append(account, n)
		case str(n, "subId") != "":
			subNodes = append(subNodes, n)
		default:
			manual = append(manual, n)
		}
	}
	return manual, subNodes, account
}

func cleanNodes(nodes []obj) []any {
	out := make([]any, 0, len(nodes))
	for _, n := range nodes {
		c := obj{}
		for k, v := range n {
			c[k] = v
		}
		for _, k := range volatileNodeKeys {
			delete(c, k)
		}
		out = append(out, c)
	}
	return out
}

func userSubs(cfg obj) []obj {
	var out []obj
	for _, s := range list(cfg["subs"]) {
		if str(s, "url") != officialSubURL {
			out = append(out, s)
		}
	}
	return out
}

// sectionsOf extracts the portable sections from a full config.json object.
func sectionsOf(cfg obj) (map[string]json.RawMessage, error) {
	manual, subNodes, _ := split(cfg)
	parts := map[string]obj{
		SecNodes: {"nodes": cleanNodes(manual), "selectedId": cfg["selectedId"]},
		SecSubs:  {"subs": toAny(userSubs(cfg)), "nodes": cleanNodes(subNodes)},
	}
	for sec, keys := range sectionKeys {
		part := obj{}
		for _, k := range keys {
			if v, ok := cfg[k]; ok && v != nil {
				part[k] = v
			}
		}
		parts[sec] = part
	}
	out := make(map[string]json.RawMessage, len(parts))
	for sec, part := range parts {
		raw, err := json.Marshal(part)
		if err != nil {
			return nil, err
		}
		out[sec] = raw
	}
	return out, nil
}

// Snapshot builds a bundle from the live config.
func Snapshot(store Store, device string) (Bundle, error) {
	raw, err := store.ExportAll()
	if err != nil {
		return Bundle{}, err
	}
	return FromConfig(raw, device)
}

// FromConfig builds a bundle from a full config.json text (also used to read
// an old full-config backup made by earlier versions).
func FromConfig(raw, device string) (Bundle, error) {
	cfg, err := decodeConfig(raw)
	if err != nil {
		return Bundle{}, err
	}
	sections, err := sectionsOf(cfg)
	if err != nil {
		return Bundle{}, err
	}
	return Bundle{Schema: Schema, App: AppTag, ExportedAt: time.Now().Format(time.RFC3339), Device: device, Sections: sections}, nil
}

// Encode renders the bundle as indented JSON.
func (b Bundle) Encode() (string, error) {
	raw, err := json.MarshalIndent(b, "", "  ")
	return string(raw), err
}

// Parse reads a bundle; a legacy full config.json backup is converted.
func Parse(data string) (Bundle, error) {
	var b Bundle
	if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &b); err != nil {
		return Bundle{}, errors.New("文件不是 ProxySplit 配置")
	}
	if b.App == "" && len(b.Sections) == 0 {
		if legacy, err := FromConfig(data, ""); err == nil && looksLikeConfig(data) {
			return legacy, nil
		}
		return Bundle{}, errors.New("文件不是 ProxySplit 配置")
	}
	if b.App != AppTag {
		return Bundle{}, errors.New("文件不是 ProxySplit 配置")
	}
	if b.Schema > Schema {
		return Bundle{}, fmt.Errorf("这份配置来自更新的版本（格式 %d），请先升级软件", b.Schema)
	}
	if len(b.Sections) == 0 {
		return Bundle{}, errors.New("配置里没有可恢复的内容")
	}
	return b, nil
}

func looksLikeConfig(data string) bool {
	var probe map[string]json.RawMessage
	if json.Unmarshal([]byte(data), &probe) != nil {
		return false
	}
	_, nodes := probe["nodes"]
	_, settings := probe["settings"]
	_, inbounds := probe["inbounds"] // sing-box runtime file, not ours
	return (nodes || settings) && !inbounds
}

// Hash fingerprints the bundle content for change detection. Subscription
// node lists are left out: a scheduled subscription refresh is not a user
// change and must not trigger an upload on every refresh.
func (b Bundle) Hash() string {
	h := sha256.New()
	for _, sec := range AllSections {
		raw, ok := b.Sections[sec]
		if !ok {
			continue
		}
		var v any
		if json.Unmarshal(raw, &v) != nil {
			continue
		}
		if m, ok := v.(obj); ok && sec == SecSubs {
			delete(m, "nodes")
			for _, s := range list(m["subs"]) {
				delete(s, "lastUpdate")
				delete(s, "nodeCount")
			}
		}
		canon, _ := json.Marshal(v) // map keys are sorted: canonical
		h.Write([]byte(sec))
		h.Write(canon)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ForSync drops the per-machine selected node from the bundle: automatic
// cloud sync never carries it (switching nodes is not a config change that
// should be uploaded or pulled). Manual export / profiles keep it.
func (b Bundle) ForSync() Bundle {
	out := b
	out.Sections = make(map[string]json.RawMessage, len(b.Sections))
	for k, v := range b.Sections {
		out.Sections[k] = v
	}
	var nodes obj
	if raw, ok := b.Sections[SecNodes]; ok && json.Unmarshal(raw, &nodes) == nil {
		delete(nodes, "selectedId")
		if raw, err := json.Marshal(nodes); err == nil {
			out.Sections[SecNodes] = raw
		}
	}
	return out
}

// SyncHash fingerprints the live config as cloud sync sees it (ForSync).
func SyncHash(store Store) (string, error) {
	b, err := Snapshot(store, "")
	if err != nil {
		return "", err
	}
	return b.ForSync().Hash(), nil
}

// LocalHash fingerprints the live config.
func LocalHash(store Store) (string, error) {
	b, err := Snapshot(store, "")
	if err != nil {
		return "", err
	}
	return b.Hash(), nil
}
