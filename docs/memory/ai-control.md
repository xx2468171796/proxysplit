# AI 控制接口 / MCP / 诊断接口

> 说明文档 docs/AI诊断接口.md；代码 mcpbridge.go、本机控制 API（端口 18088）。

## 排查分流先用内置诊断接口
本机 18088 的 /api/diag、/api/diag/selftest、/api/diag/route-test（改名 curl 冒充程序真实访问，看命中规则和出口）及同名 MCP 工具，随 1.9.67 上线。
- 远程机器经堡垒机 run_command 调；alonehome2 上用 `C:\ProgramData\ps-diagrun\psapi.ps1`（见 testing-machines.md）。
- 控制接口还有 /api/account、/api/account/login、/api/settings（部分更新）、/api/nodes/add|remove（1.9.68）。

## 控制接口的守卫（2026-11-18 审计，apiauth.go / apihello.go / apiops.go）
- 每条路由都过 `guard`：Host 必须是回环名（挡 DNS 重绑定）、带 Origin 的一律 403（浏览器不能调）、令牌只认 `Authorization: Bearer`（`?token=` 已取消）并用定长比较、GET 只读、改动必须 POST + `Content-Type: application/json`（没参数发 `{}`）、请求体 ≤ 1 MB。唯一免令牌的是 `GET /api/hello`。
- 路由表 `controlRoutes()`（apiserver.go + diagapi.go）：每条写明 get / post，没写的方法回 405。新加路由必须在 `apileak_test.go` 里给请求体或写明跳过原因，否则测试不过。
- HTTP 与 MCP 共用 apiops.go 的操作，返回都已脱敏：节点只给 `apiNode`（无凭据），局域网密码 `***`（原样 POST 回来 = 不改），日志 / 路由测试 / 自检过 `telemetry.Sanitize`，内核配置按字段名打码（`service.secretKey` = `telemetry.SecretField` + 容器键 users / obfs / headers；Reality public_key 是写明的例外）。
- 令牌：`service.newAPIToken()` 是唯一生成处（`randomHex(32)`）；界面「重新生成令牌」→ `RegenerateAIControlToken`，每个请求现读所以立刻生效；恢复出厂也换；`ImportAll` 忽略文件里的 apiToken（撤销重置也不会把旧令牌带回来）。
- `/api/hello`：程序监听后在数据目录写 `control-api.json`（port / pid / nonce，退出时删），桥先核对 pid 活着、再用随机 challenge 要 HMAC(nonce, challenge)，对上才发令牌——18088 是固定端口，程序没开时任何本机程序都能占。重置不删这个文件（reset_test.go 钉住）。
- 测试机的 `psapi.ps1` 要按新规则发请求（Bearer 头、POST 带 JSON 类型）——**本轮没有上测试机核对，发版前要跑一次**。

## 软件没打开时也能被 AI 控制（--mcp 桥）
`proxysplit.exe --mcp` 是 stdio MCP 桥（mcpbridge.go）：initialize / tools/list 本地应答不拉起程序，tools/call 时若 18088 不通就以 `--background`（StartHidden，只驻托盘）拉起再转发 /mcp。
- 未登录 / 启动失败 / 托盘没起来时自动显示窗口；token 每次从 config.json 读（重新生成后不用改 MCP 配置）；界面「复制 MCP 配置」是 stdio 命令写法。`--background` 启动时服务层按「窗口不可见」降低后台探测频率，窗口显示后恢复（`Service.SetUIVisible`）。
- 自动更新助手：`.old` 若被仍在跑旧版的 --mcp 桥占着删不掉，改名 `.old.<ticks>.stale`，程序启动时清理。
- 本机用开发版（appVersion=dev，无授权）实测通过。下一步想法：堡垒机「翻墙」能力（按人授权、节点分类下发、延迟自检），客户端接堡垒机密钥鉴权。

## DNS 已知问题
系统 DNS 为公网地址时，开代理后查不存在的域名要等约 12 秒（strict_route 拦其它网卡 DNS，Windows 等全部网卡回答），详见 docs/AI诊断接口.md「已知问题」。
