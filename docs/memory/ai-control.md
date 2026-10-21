# AI 控制接口 / MCP / 诊断接口

> 说明文档 docs/AI诊断接口.md；代码 mcpbridge.go、本机控制 API（端口 18088）。

## 排查分流先用内置诊断接口
本机 18088 的 /api/diag、/api/diag/selftest、/api/diag/route-test（改名 curl 冒充程序真实访问，看命中规则和出口）及同名 MCP 工具，随 1.9.67 上线。
- 远程机器经堡垒机 run_command 调；alonehome2 上用 `C:\ProgramData\ps-diagrun\psapi.ps1`（见 testing-machines.md）。
- 控制接口还有 /api/account、/api/account/login、/api/settings（部分更新）、/api/nodes/add|remove（1.9.68）。

## 软件没打开时也能被 AI 控制（--mcp 桥）
`proxysplit.exe --mcp` 是 stdio MCP 桥（mcpbridge.go）：initialize / tools/list 本地应答不拉起程序，tools/call 时若 18088 不通就以 `--background`（StartHidden，只驻托盘）拉起再转发 /mcp。
- 未登录 / 启动失败 / 托盘没起来时自动显示窗口；token 每次从 config.json 读；界面「复制 MCP 配置」是 stdio 命令写法。
- 自动更新助手：`.old` 若被仍在跑旧版的 --mcp 桥占着删不掉，改名 `.old.<ticks>.stale`，程序启动时清理。
- 本机用开发版（appVersion=dev，无授权）实测通过。下一步想法：堡垒机「翻墙」能力（按人授权、节点分类下发、延迟自检），客户端接堡垒机密钥鉴权。

## DNS 已知问题
系统 DNS 为公网地址时，开代理后查不存在的域名要等约 12 秒（strict_route 拦其它网卡 DNS，Windows 等全部网卡回答），详见 docs/AI诊断接口.md「已知问题」。
