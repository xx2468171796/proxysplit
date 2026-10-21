package main

import "testing"

func TestNotesSince(t *testing.T) {
	md := "# 更新日志\n\n## v1.9.78\n\n- 新 A\n  续行\n- 新 B\n\n## v1.9.77\n\n- 中\n\n## v1.9.76\n\n- 旧\n"
	all := parseChangelog(md)
	if len(all) != 3 || all[0].Items[0] != "新 A 续行" {
		t.Fatalf("parse = %+v", all)
	}
	got := notesSince(all, "1.9.76", "1.9.78")
	if len(got) != 2 || got[0].Version != "1.9.78" || got[1].Version != "1.9.77" {
		t.Fatalf("since = %+v", got)
	}
	if n := notesSince(all, "1.9.78", "1.9.78"); len(n) != 0 {
		t.Fatalf("already seen = %+v", n)
	}
	if !versionLess("1.9.9", "1.9.10") {
		t.Fatal("numeric compare")
	}
}
