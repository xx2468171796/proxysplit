package accel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// ClaudeSettings 改写 / 还原 Claude Code 的 ~/.claude/settings.json（CLI 与 VS Code 插件都读它的 env）。
//
// 编码模式：env.ANTHROPIC_BASE_URL 指向本机编码端；env.ENABLE_TOOL_SEARCH 不存在时补 "true"
// （自定义地址下 Claude Code 默认关工具搜索，会多耗 token）。其余内容、键顺序、格式一律不动。
// 还原：首次改之前把原文件原样存档；文件在我们写完后没被动过 → 逐字节写回原文件（原来没有就删掉）；
// 用户期间改过 → 只撤我们加的两个键（值仍是我们写的才撤），不碰用户的改动。
type ClaudeSettings struct {
	Path     string // settings.json
	Snapshot string // 存档（放在 ProxySplit 数据目录）
}

// ErrGatewayInUse 用户已经自己配了别的 ANTHROPIC_BASE_URL（比如公司网关）：不接管
var ErrGatewayInUse = errors.New("Claude Code 已配置其他网关地址")

type claudeSnapshot struct {
	Existed       bool   `json:"existed"`
	Original      []byte `json:"original"`
	URL           string `json:"url"`
	AddedToolSrch bool   `json:"addedToolSearch"`
	WrittenSha    string `json:"writtenSha"`
}

// DefaultClaudeSettingsPath：CLAUDE_CONFIG_DIR 优先，否则 %USERPROFILE%\.claude\settings.json
func DefaultClaudeSettingsPath() string {
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return filepath.Join(d, "settings.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "settings.json")
}

func shaHex(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func (c *ClaudeSettings) loadSnap() (*claudeSnapshot, error) {
	raw, err := os.ReadFile(c.Snapshot)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s claudeSnapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *ClaudeSettings) saveSnap(s *claudeSnapshot) error {
	raw, _ := json.Marshal(s)
	return writeAtomic(c.Snapshot, raw)
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".proxysplit-tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Active 报告当前文件是否指向 url
func (c *ClaudeSettings) Active(url string) bool {
	raw, err := os.ReadFile(c.Path)
	return err == nil && gjson.GetBytes(raw, "env.ANTHROPIC_BASE_URL").String() == url
}

// Apply 让 Claude Code 走本机编码端
func (c *ClaudeSettings) Apply(url string) error {
	raw, err := os.ReadFile(c.Path)
	existed := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if existed && len(bytes.TrimSpace(raw)) > 0 && !gjson.ValidBytes(raw) {
		return errors.New("Claude Code 配置文件不是合法 JSON，不去改它")
	}
	snap, err := c.loadSnap()
	if err != nil {
		return err
	}
	cur := gjson.GetBytes(raw, "env.ANTHROPIC_BASE_URL").String()
	ours := snap != nil && cur == snap.URL
	if cur != "" && cur != url && !ours {
		return ErrGatewayInUse
	}
	if cur == url && snap != nil {
		return nil // 已经是编码模式
	}
	if snap == nil {
		snap = &claudeSnapshot{Existed: existed, Original: append([]byte(nil), raw...)}
	}
	doc := raw
	if len(bytes.TrimSpace(doc)) == 0 {
		doc = []byte("{}")
	}
	if doc, err = sjson.SetBytes(doc, "env.ANTHROPIC_BASE_URL", url); err != nil {
		return err
	}
	if !gjson.GetBytes(doc, "env.ENABLE_TOOL_SEARCH").Exists() {
		if doc, err = sjson.SetBytes(doc, "env.ENABLE_TOOL_SEARCH", "true"); err != nil {
			return err
		}
		snap.AddedToolSrch = true
	}
	snap.URL = url
	snap.WrittenSha = shaHex(doc)
	// 先存档再改文件：进程在两步之间崩了，下次启动仍能还原
	if err := c.saveSnap(snap); err != nil {
		return err
	}
	return writeAtomic(c.Path, doc)
}

// Restore 恢复官方默认；没改过就什么都不做
func (c *ClaudeSettings) Restore() error {
	snap, err := c.loadSnap()
	if err != nil || snap == nil {
		return err
	}
	raw, rerr := os.ReadFile(c.Path)
	switch {
	case rerr == nil && shaHex(raw) == snap.WrittenSha:
		// 我们写完后没人动过：逐字节还原
		if snap.Existed {
			err = writeAtomic(c.Path, snap.Original)
		} else {
			err = os.Remove(c.Path)
		}
	case rerr == nil:
		// 用户期间改过：只撤我们加的键（值还是我们写的才撤）
		doc := raw
		if gjson.GetBytes(doc, "env.ANTHROPIC_BASE_URL").String() == snap.URL {
			doc, _ = sjson.DeleteBytes(doc, "env.ANTHROPIC_BASE_URL")
		}
		if snap.AddedToolSrch && gjson.GetBytes(doc, "env.ENABLE_TOOL_SEARCH").String() == "true" {
			doc, _ = sjson.DeleteBytes(doc, "env.ENABLE_TOOL_SEARCH")
		}
		if !bytes.Equal(doc, raw) {
			err = writeAtomic(c.Path, doc)
		}
	case errors.Is(rerr, os.ErrNotExist):
		// 文件被用户删了：尊重用户，不再造
	default:
		return rerr
	}
	if err != nil {
		return err
	}
	return os.Remove(c.Snapshot)
}
