# aienv：AI 使用环境一键配置 / 一键恢复

把一台 Windows 电脑的本机信号和台湾出口对齐（官方订阅防风控），并能一键改回原样。
ProxySplit 在「设置 → 环境配置」里用它；aigw 网关切换器等其他 Go 程序可以直接复用。

## 配置项

| id | 名称 | 配成 | 能否恢复 |
|---|---|---|---|
| `timezone` | 系统时区 | Taipei Standard Time（与北京同为 UTC+8，钟点不变） | 能 |
| `culture` | 区域格式 | zh-TW（只影响日期、数字格式，界面语言不变） | 能 |
| `homeloc` | 所在地区 | 台湾（GeoID 237） | 能 |
| `browserlang` | 浏览器语言 | Chrome / Edge 策略 ForcedLanguages = zh-TW,zh,en-US,en | 能 |
| `claudecode` | Claude Code 遥测 | `~/.claude/settings.json` 的 env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 | 能 |
| `clock` | 系统时间 | 立即对时 | 不需要（只是对时） |
| `fonts` | 中文字体 / Emoji | 不改，只作说明（删字体会乱码） | — |

## 用法

```go
import "proxysplit/pkg/aienv" // 搬到别的仓库时改成新的模块路径

m := aienv.New(filepath.Join(dataDir, "aienv-state.json"))
items := m.Status()          // 每项的现状、目标、是否已配置
err := m.Apply()             // 全部配置；Apply("timezone", "browserlang") 只配这几项
err = m.Restore()            // 按状态文件逐项改回配置前的原样
```

- 每项第一次改之前，把原值写进状态文件；重复 Apply 不会覆盖最初的原值。
- Restore 只改回我们改过的项，改回后从状态文件里删掉；全部改回后状态文件自动删除。
- 宿主之前自己改过某项、想交给本包恢复，用 `m.Adopt(id, 原值)`；原来不存在的设置传 `aienv.Absent`。
- 改时区、对时需要管理员权限；其余项只改当前用户。
- 所有外部命令都隐藏窗口（不闪黑框）。

## 依赖

只用标准库、`golang.org/x/sys/windows/registry`、`github.com/tidwall/gjson`、`github.com/tidwall/sjson`，
不引用 ProxySplit 的其他包。复用时把整个目录拷过去（或抽成独立模块）即可。

## 已验证

- 单元测试：Claude Code 配置改了再恢复，文件逐字节还原；用户原有的值会恢复，不会删掉；JSON 格式坏了不动它。
- 真机（2026-10-23，Windows 11）：区域格式 zh-CN → zh-TW → zh-CN、所在地区 45 → 237 → 45，原样还原。
