package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseDealerExe(t *testing.T) {
	tk := "Abc_-" + "x0123456789012345678901234567890123456789"[:38]
	dl := filepath.Join("Downloads") + string(filepath.Separator)
	cases := []struct {
		exe, slug, ticket string
	}{
		{"proxysplit-ai-d-wen.exe", "wen", ""},
		{"proxysplit-ai-d-wen (1).exe", "wen", ""},
		{"proxysplit-ai-d-wen(2).exe", "wen", ""},
		{"ProxySplit-AI-D-Wen.EXE", "wen", ""},
		{"proxysplit-ai-d-my-shop-2.exe", "my-shop-2", ""},
		{"proxysplit-ai-d-wen-" + tk + ".exe", "wen", tk},
		{"proxysplit-ai-d-wen-" + tk + " (1).exe", "wen", tk},
		{"proxysplit-ai-d-my-shop-" + tk + ".exe", "my-shop", tk},
		{"proxysplit-ai-d-" + "abcdefghijabcdefghijabcdefghij" + ".exe", "abcdefghijabcdefghijabcdefghij", ""},
		{"proxysplit-ai-d-" + "abcdefghijabcdefghijabcdefghijk" + ".exe", "", ""}, // 31 chars
		{"proxysplit-ai-d-w.exe", "", ""},                                          // 1 char
		{"proxysplit-ai-d-we_n.exe", "", ""},
		{"proxysplit-ai-d-.exe", "", ""},
		{"proxysplit-ai-d-wen.zip", "", ""},
		{"proxysplit-ai-latest.exe", "", ""},
		{"proxysplit-ai-" + tk + ".exe", "", ""},
		{"proxysplit-latest.exe", "", ""},
		{"x-proxysplit-ai-d-wen.exe", "", ""},
		{"proxysplit-ai-d-we!n-" + tk + ".exe", "", ""},
	}
	for _, c := range cases {
		slug, ticket := parseDealerExe(dl + c.exe)
		if slug != c.slug || ticket != c.ticket {
			t.Errorf("%s: got %q/%q want %q/%q", c.exe, slug, ticket, c.slug, c.ticket)
		}
		if c.slug != "" && !exeMarksAIGW(c.exe) {
			t.Errorf("%s: a dealer download must also mark the AI-site channel", c.exe)
		}
		// The shared ticket entry point sees dealer tickets too, never main-site ones as dealer.
		if c.ticket != "" && downloadTicket(dl+c.exe) != c.ticket {
			t.Errorf("%s: downloadTicket missed the dealer ticket", c.exe)
		}
	}
	if downloadTicket(dl+"proxysplit-ai-d-wen.exe") != "" {
		t.Error("plain dealer download carries no ticket")
	}
}

func TestResolveDealer(t *testing.T) {
	file := filepath.Join(t.TempDir(), "dealer")
	if s, p := resolveDealer(file, "proxysplit.exe"); s != "" || p {
		t.Fatalf("plain exe: %q/%v", s, p)
	}
	if s, p := resolveDealer(file, "proxysplit-ai-d-wen (1).exe"); s != "wen" || !p {
		t.Fatalf("dealer exe: %q/%v", s, p)
	}
	if err := os.WriteFile(file, []byte("wen\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// First value wins: another dealer's installer or a rename doesn't change it.
	if s, p := resolveDealer(file, "proxysplit-ai-d-other.exe"); s != "wen" || p {
		t.Fatalf("persisted marker ignored: %q/%v", s, p)
	}
	if err := os.WriteFile(file, []byte("../x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if s, _ := resolveDealer(file, "proxysplit.exe"); s != "" {
		t.Fatalf("invalid marker must be ignored, got %q", s)
	}
}
