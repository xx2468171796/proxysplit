package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"proxysplit/internal/nodes"
)

var testAIOnly = &nodes.Egress{Mode: "ai_only", Allow: &nodes.EgressAllow{
	Domains: []string{"cc-tw.5fskins.com"}, DomainSuffixes: []string{"anthropic.com", " "}, IPCIDRs: []string{"160.79.104.0/23"},
}}

func TestRestrictEgressRules(t *testing.T) {
	r := restrictedTags{}
	r.add("node-a", &nodes.Node{Egress: testAIOnly})
	r.add("node-b", &nodes.Node{Egress: &nodes.Egress{Mode: "all"}})
	r.add("node-c", &nodes.Node{Egress: &nodes.Egress{Mode: "ai_only"}}) // empty list: nothing may use it
	allow := M{"domain": []string{"cc-tw.5fskins.com"}, "domain_suffix": []string{"anthropic.com"}, "ip_cidr": []string{"160.79.104.0/23"}}

	rules, final := restrictEgress([]M{
		{"action": "sniff"},
		{"inbound": []string{"in-a"}, "outbound": "node-a"},
		{"rule_set": []string{"x"}, "outbound": "node-b"},
		{"rule_set": []string{"y"}, "outbound": "node-c"},
	}, "node-a", r)
	want := []M{
		{"action": "sniff"},
		{"type": "logical", "mode": "and", "rules": []M{{"inbound": []string{"in-a"}}, allow}, "outbound": "node-a"},
		{"inbound": []string{"in-a"}, "outbound": "direct"},
		{"rule_set": []string{"x"}, "outbound": "node-b"},
		{"rule_set": []string{"y"}, "outbound": "direct"},
		{"domain": []string{"cc-tw.5fskins.com"}, "domain_suffix": []string{"anthropic.com"}, "ip_cidr": []string{"160.79.104.0/23"}, "outbound": "node-a"},
	}
	if final != "direct" || !reflect.DeepEqual(rules, want) {
		b, _ := json.MarshalIndent(rules, "", " ")
		t.Fatalf("final=%s rules=%s", final, b)
	}

	// Blocked list (every plan): blocked → direct (minus exceptions), the rest
	// keeps its line, final included.
	d := restrictedTags{}
	d.add("proxy", &nodes.Node{Egress: &nodes.Egress{Mode: "all",
		Deny: &nodes.EgressAllow{DomainSuffixes: []string{"gov.tw"}}, DenyExcept: []string{"bank.gov.tw"}}})
	deny := M{"type": "logical", "mode": "and", "rules": []M{{"domain_suffix": []string{"gov.tw"}}, {"domain_suffix": []string{"bank.gov.tw"}, "invert": true}}}
	rules, final = restrictEgress([]M{{"rule_set": []string{"g"}, "outbound": "proxy"}}, "proxy", d)
	want = []M{
		{"type": "logical", "mode": "and", "rules": []M{{"rule_set": []string{"g"}}, deny}, "outbound": "direct"},
		{"rule_set": []string{"g"}, "outbound": "proxy"},
		{"type": "logical", "mode": "and", "rules": []M{{"domain_suffix": []string{"gov.tw"}}, {"domain_suffix": []string{"bank.gov.tw"}, "invert": true}}, "outbound": "direct"},
	}
	if final != "proxy" || !reflect.DeepEqual(rules, want) {
		b, _ := json.MarshalIndent(rules, "", " ")
		t.Fatalf("deny: final=%s rules=%s", final, b)
	}

	// Unrestricted configs are untouched.
	in := []M{{"outbound": "proxy"}}
	if got, f := restrictEgress(in, "proxy", restrictedTags{}); !reflect.DeepEqual(got, in) || f != "proxy" {
		t.Fatalf("unrestricted config changed: %v %s", got, f)
	}
	// Unknown modes from a newer panel behave like "all".
	if (&nodes.Egress{Mode: "future"}).Restricted() {
		t.Fatal("unknown mode must not restrict")
	}
}

// Both builders produce configs the real core accepts with a 仅 AI node.
func TestEgressConfigsPassCheck(t *testing.T) {
	bin := singboxPath(t)
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	node.Egress = testAIOnly
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	multi, err := BuildConfig(node, 17890, "warn", Options{RouteMode: RouteGlobal})
	if err != nil {
		t.Fatal(err)
	}
	tun, err := BuildTUNConfig(node, "warn", Options{RouteMode: RouteGlobal, GeoDir: geoDir, ClashController: "127.0.0.1:19090"})
	if err != nil {
		t.Fatal(err)
	}
	for name, cfg := range map[string][]byte{"multi": multi, "tun": tun} {
		var parsed struct {
			Route struct {
				Final string `json:"final"`
				Rules []M    `json:"rules"`
			} `json:"route"`
		}
		json.Unmarshal(cfg, &parsed)
		if parsed.Route.Final != "direct" {
			t.Errorf("%s: final = %s, want direct", name, parsed.Route.Final)
		}
		if !sniffFirst(parsed.Route.Rules) {
			t.Errorf("%s: 仅 AI routing needs sniff first", name)
		}
		p := filepath.Join(t.TempDir(), name+".json")
		os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Errorf("%s: sing-box check: %v\n%s\n%s", name, err, out, cfg)
		}
	}
}

// sniffFirst: sniff is the first rule, or follows only tunPreSniffRules.
func sniffFirst(rules []M) bool {
	for i, r := range rules {
		if r["action"] == "sniff" {
			return i == 0 || i == len(tunPreSniffRules(tunAddr4Pool[0]))
		}
	}
	return false
}
