package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestDiagAPIRemoteControl drives the remote-control endpoints over real HTTP:
// partial settings update, node import, account state, custom rules.
func TestDiagAPIRemoteControl(t *testing.T) {
	f := newControlFixture(t)
	svc := f.app.svc

	call := func(method, path, body string, out any) {
		t.Helper()
		status, answer := f.do(t, controlCall{method: method, path: path, body: body})
		if status != 200 {
			t.Fatalf("%s %s: status %d", method, path, status)
		}
		if out != nil {
			if err := json.Unmarshal([]byte(answer), out); err != nil {
				t.Fatal(err)
			}
		}
	}

	before := svc.GetSettings()
	var ok map[string]any
	call("POST", "/api/settings", `{"tunMode":true,"blockQUIC":false}`, &ok)
	if ok["ok"] != true {
		t.Fatalf("settings: %v", ok)
	}
	after := svc.GetSettings()
	if !after.TunMode || after.BlockQUIC || after.RemoteDNS != before.RemoteDNS || after.Theme != before.Theme {
		t.Fatalf("partial settings update changed the wrong fields: %+v", after)
	}

	var added AddResult
	call("POST", "/api/nodes/add", `{"text":"trojan://pw@example.com:443?sni=example.com#t1"}`, &added)
	if added.Added != 1 || len(svc.Nodes()) != 1 {
		t.Fatalf("nodes add: %+v", added)
	}

	nodeID := svc.Nodes()[0].ID
	call("POST", "/api/nodes/core", `{"id":"`+nodeID+`","core":"xray"}`, &ok)
	if ok["ok"] != true || svc.Nodes()[0].Core != "xray" {
		t.Fatalf("nodes core: %v %q", ok, svc.Nodes()[0].Core)
	}
	var bad map[string]any
	call("POST", "/api/nodes/core", `{"id":"`+nodeID+`","core":"v2ray"}`, &bad)
	if bad["ok"] != false || !strings.Contains(mustJSON(bad), "未知内核") {
		t.Fatalf("bad core accepted: %v", bad)
	}

	var acct map[string]any
	call("GET", "/api/account", "", &acct)
	if _, has := acct["license"]; !has {
		t.Fatalf("account: %v", acct)
	}

	call("POST", "/api/custom-rules", `{"rules":[{"type":"suffix","value":"Example.COM","action":"direct"}]}`, &ok)
	if r := svc.GetCustomRules(); len(r) != 1 || r[0].Value != "example.com" {
		t.Fatalf("custom rules: %+v", r)
	}

	var snap map[string]any
	call("GET", "/api/diag", "", &snap)
	if strings.Contains(mustJSON(snap), `"pw"`) {
		t.Fatal("diagnose leaked a node password")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
