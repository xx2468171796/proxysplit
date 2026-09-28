package accel

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newCfg(t *testing.T) *ClaudeSettings {
	d := t.TempDir()
	return &ClaudeSettings{Path: filepath.Join(d, ".claude", "settings.json"), Snapshot: filepath.Join(d, "ps", "claude-accel-restore.json")}
}

const url1 = "http://127.0.0.1:18765"

func TestClaudeApplyRestoreByteExact(t *testing.T) {
	c := newCfg(t)
	orig := "{\n  // 注释不是 JSON，这里不用\n}"
	orig = "{\n    \"permissions\": {\"allow\": [\"Bash\"]},\n    \"env\": {\"FOO\": \"1\"},\n    \"model\": \"opus\"\n}\n"
	os.MkdirAll(filepath.Dir(c.Path), 0o755)
	os.WriteFile(c.Path, []byte(orig), 0o644)
	if err := c.Apply(url1); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(c.Path)
	s := string(got)
	if !strings.Contains(s, `"ANTHROPIC_BASE_URL":"`+url1+`"`) && !strings.Contains(s, `"ANTHROPIC_BASE_URL": "`+url1+`"`) {
		t.Fatalf("应写入地址：%s", s)
	}
	if !strings.Contains(s, "ENABLE_TOOL_SEARCH") || !strings.Contains(s, `"FOO": "1"`) || strings.Index(s, "permissions") > strings.Index(s, "model") {
		t.Fatalf("其他内容与顺序不能动：%s", s)
	}
	if !c.Active(url1) {
		t.Fatal("应报告为编码模式")
	}
	if err := c.Apply(url1); err != nil { // 重复应用幂等
		t.Fatal(err)
	}
	if err := c.Restore(); err != nil {
		t.Fatal(err)
	}
	back, _ := os.ReadFile(c.Path)
	if string(back) != orig {
		t.Fatalf("应逐字节还原：\n%q\n%q", back, orig)
	}
	if _, err := os.Stat(c.Snapshot); !os.IsNotExist(err) {
		t.Fatal("还原后存档应删除")
	}
	if err := c.Restore(); err != nil { // 没改过时还原是空操作
		t.Fatal(err)
	}
}

func TestClaudeRestoreWhenFileDidNotExist(t *testing.T) {
	c := newCfg(t)
	if err := c.Apply(url1); err != nil {
		t.Fatal(err)
	}
	if err := c.Restore(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(c.Path); !os.IsNotExist(err) {
		t.Fatal("原来没有的文件，还原后应删掉")
	}
}

func TestClaudeRestoreKeepsUserEditsAndOwnToolSearch(t *testing.T) {
	c := newCfg(t)
	os.MkdirAll(filepath.Dir(c.Path), 0o755)
	os.WriteFile(c.Path, []byte(`{"env":{"ENABLE_TOOL_SEARCH":"false"}}`), 0o644)
	if err := c.Apply(url1); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(c.Path)
	if !strings.Contains(string(raw), `"ENABLE_TOOL_SEARCH":"false"`) {
		t.Fatalf("用户设的 false 不能被覆盖：%s", raw)
	}
	// 用户期间自己加了一个键
	edited := strings.Replace(string(raw), `"env":{`, `"env":{"MINE":"x",`, 1)
	os.WriteFile(c.Path, []byte(edited), 0o644)
	if err := c.Restore(); err != nil {
		t.Fatal(err)
	}
	back, _ := os.ReadFile(c.Path)
	s := string(back)
	if strings.Contains(s, "ANTHROPIC_BASE_URL") || !strings.Contains(s, `"MINE":"x"`) || !strings.Contains(s, `"ENABLE_TOOL_SEARCH":"false"`) {
		t.Fatalf("只撤我们的地址，保留用户改动与用户自己的键：%s", s)
	}
}

func TestClaudeRefusesOtherGatewayAndBadJSON(t *testing.T) {
	c := newCfg(t)
	os.MkdirAll(filepath.Dir(c.Path), 0o755)
	os.WriteFile(c.Path, []byte(`{"env":{"ANTHROPIC_BASE_URL":"https://sub2api.example.com"}}`), 0o644)
	if err := c.Apply(url1); err != ErrGatewayInUse {
		t.Fatalf("已有其他网关应拒绝接管：%v", err)
	}
	os.WriteFile(c.Path, []byte(`{not json`), 0o644)
	if err := c.Apply(url1); err == nil {
		t.Fatal("坏 JSON 不能改")
	}
	b, _ := os.ReadFile(c.Path)
	if string(b) != `{not json` {
		t.Fatal("坏 JSON 文件必须原样保留")
	}
}

func TestClaudeApplyFollowsPortChange(t *testing.T) {
	c := newCfg(t)
	os.MkdirAll(filepath.Dir(c.Path), 0o755)
	orig := `{"theme":"dark"}`
	os.WriteFile(c.Path, []byte(orig), 0o644)
	c.Apply(url1)
	if err := c.Apply("http://127.0.0.1:20001"); err != nil {
		t.Fatalf("自己写的旧端口应能改成新端口：%v", err)
	}
	if !c.Active("http://127.0.0.1:20001") {
		t.Fatal("应指向新端口")
	}
	c.Restore()
	if b, _ := os.ReadFile(c.Path); string(b) != orig {
		t.Fatalf("换过端口后仍应逐字节还原：%s", b)
	}
}
