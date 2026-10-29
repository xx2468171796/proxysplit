package service

import (
	"strings"
	"testing"
)

func TestFormatConnLine(t *testing.T) {
	got := formatConnLine(ConnInfo{Process: "chrome.exe", Outbound: "香港 01", Host: "www.google.com", Dest: "142.250.1.1:443", Rule: "process_name chrome.exe", Network: "tcp"})
	want := "[conn] chrome.exe → 香港 01 → www.google.com:443 rule=process_name chrome.exe"
	if got != want {
		t.Fatalf("got %q", got)
	}
	got = formatConnLine(ConnInfo{OutTag: "direct", Dest: "[2001:db8::1]:53", Network: "udp"})
	if got != "[conn] 未知进程 → direct → [2001:db8::1]:53 rule=- net=udp" {
		t.Fatalf("got %q", got)
	}
}

func TestConnLogLinesDedupe(t *testing.T) {
	a := ConnInfo{ID: "a", Process: "a.exe", Outbound: "直连", Host: "a.com", Dest: "1.1.1.1:443"}
	b := ConnInfo{ID: "b", Process: "b.exe", Outbound: "直连", Host: "b.com", Dest: "1.1.1.2:443"}
	lines, seen := connLogLines([]ConnInfo{a, a, b}, nil, 500)
	if len(lines) != 2 {
		t.Fatalf("first tick %v", lines)
	}
	c := ConnInfo{ID: "c", Process: "c.exe", Host: "c.com", Dest: "1.1.1.3:80"}
	lines, seen = connLogLines([]ConnInfo{a, b, c}, seen, 500)
	if len(lines) != 1 || !strings.Contains(lines[0], "c.exe") {
		t.Fatalf("second tick %v", lines)
	}
	// a closed and came back with the same id after a tick away: logged again.
	lines, _ = connLogLines([]ConnInfo{a}, map[string]bool{"c": true}, 500)
	if len(lines) != 1 {
		t.Fatalf("third tick %v", lines)
	}
	_ = seen
}

func TestConnLogLinesCap(t *testing.T) {
	var conns []ConnInfo
	for i := range 7 {
		conns = append(conns, ConnInfo{ID: string(rune('a' + i)), Process: "x.exe", Dest: "1.1.1.1:443"})
	}
	lines, _ := connLogLines(conns, nil, 5)
	if len(lines) != 6 || !strings.Contains(lines[5], "还有 2 条") {
		t.Fatalf("cap %v", lines)
	}
}
