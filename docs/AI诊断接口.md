# AI 诊断与测试接口

ProxySplit 内置一组诊断接口，让 AI（或工程师）在任何一台装了客户端的电脑上，直接查看分流状态、真实测试某个程序访问某个网站走了哪里。排查「某网站打不开 / 规则不生效」时先用它，不要靠猜。

## 怎么连

- 地址：`http://127.0.0.1:18088`，只监听本机。
- 鉴权：请求头 `Authorization: Bearer <token>`。token 在软件「设置 → AI 控制」里能复制，也在 `%APPDATA%\proxysplit\config.json` 的 `apiToken` 字段。
- 远程机器：通过堡垒机 `run_command` 在那台机器上执行 PowerShell / curl 调用即可。
- MCP：同名工具也挂在 `/mcp` 和 `proxysplit.exe --mcp` 上（见下表）。

## 接口

| 接口 | MCP 工具 | 作用 |
|---|---|---|
| `GET /api/diag` | `proxysplit_diagnose` | 诊断快照：版本、是否运行、代理策略、分流模式、整机全局、应用规则、自定义规则、自定义线路、规则库状态、节点（不含密码）、当前生效的内核配置（密钥已脱敏）、各应用名单文件、常见问题提示 |
| `POST /api/diag/route-test` `{"process":"chrome.exe","url":"https://www.baidu.com"}` | `proxysplit_route_test` | 以该程序名真实访问网址，返回 HTTP 状态、耗时、命中的规则、出口（direct / node / reject）、相关内核日志 |
| `POST /api/diag/selftest` | `proxysplit_selftest` | 一键自检：每个列出的应用（最多 6 个）和一个未列出的程序，分别访问百度 / QQ / Google / YouTube，与当前设置「应该」的结果对比，`FAIL` 即不符合预期；附 DNS 解析结果。约 1 分钟 |
| `GET /api/diag/logs?n=300&grep=baidu` | `proxysplit_logs` | 最近日志（含内核日志），可过滤 |
| `GET/POST /api/custom-rules` `{"rules":[{"type":"suffix","value":"x.com","action":"proxy"}]}` | `proxysplit_set_custom_rules` | 读取 / 整体替换自定义规则 |
| `POST /api/split-mode` `{"mode":"whitelist"}` | `proxysplit_set_split_mode` | 分流模式：whitelist = 只代理列出的，blacklist = 默认全走代理 |
| `POST /api/log-level` `{"level":"info"}` | — | 日志级别；路由测试读日志需要 info 或 debug |
| `GET /api/account` | `proxysplit_account` | 登录与会员状态（ProxySplit 账号、POWER云） |
| `POST /api/account/login` `{"username","password"}` | — | 用 ProxySplit 账号登录（密码经标准输入传给 curl，别写进命令行） |
| `GET/POST /api/settings`（POST 只传要改的字段，如 `{"tunMode":true}`） | `proxysplit_set_settings` | 读取 / 修改设置：整机全局、阻止 QUIC、远程解析、内网直连等 |
| `POST /api/nodes/add` `{"text":"链接
链接"}`；`POST /api/nodes/remove` `{"id"}` | `proxysplit_add_nodes` | 导入 / 删除节点 |

原有接口（状态、节点、应用、代理策略、启动 / 停止）不变。装好并启动软件后，AI 经堡垒机 `run_command` 调这些接口就能从登录到测试全程远程操作，不用点界面。

## 路由测试原理

把系统自带的 `C:\Windows\System32\curl.exe` 复制到临时目录并改名为要测的程序名，再用它发请求。内核按进程名分流，所以它会被当成那个程序处理。结果来自两处：内核 clash_api 的实时连接表（有命中规则）和内核日志（有出口）。

- `route`：`direct` 直连、`node` 走节点、`reject` 被拦截或连接失败、`unknown` 没抓到。
- 代理没运行时结果一定是直连，`note` 会说明。
- 自检里命中自定义规则的网站、以及 POWER云 有访问范围限制时的境外网站，只报告不判定（`verdict=info`）。

## 示例（PowerShell）

```powershell
$t = (Get-Content "$env:APPDATA\proxysplit\config.json" -Raw | ConvertFrom-Json).apiToken
$h = @{ Authorization = "Bearer $t" }
Invoke-RestMethod http://127.0.0.1:18088/api/diag -Headers $h | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:18088/api/diag/selftest -Method Post -Headers $h | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:18088/api/diag/route-test -Method Post -Headers $h -ContentType 'application/json' -Body '{"process":"chrome.exe","url":"https://www.baidu.com"}'
```

## 不登录的远程测试：cmd/diagrun

装了正式版但登录不方便（比如别人正在用那台电脑）时，用 `cmd/diagrun` 在那台机器上直接跑同一套分流代码和真实内核（TUN），不需要界面、不需要登录：

1. 本机 `go build -o diagrun.exe ./cmd/diagrun`，和 `bin\sing-box.exe` + 三个 `.srs` 一起放到目标机，例如 `C:\ProgramData\ps-diagrun\`（exe 旁边一个 `bin` 目录）。
2. 节点链接含密码，**只经标准输入传入**：先把链接写进临时文件，再 `cmd /c "diagrun.exe -link - -mode whitelist -app chrome.exe=rule < link.txt"`，跑完立刻删掉链接文件和 `%TEMP%\proxysplit-diagrun`（里面的配置也有密码）。
3. 常用参数：`-mode whitelist|blacklist|tun`、`-clash rule|global|direct`、`-app 名称=线路`（可多个）、`-custom 类型:值:动作`（可多个）、`-test 程序=网址`（可多个）、`-cold 15s`（启动后立刻持续测 DNS）、`-loglevel debug`、`-limit 4m`（到时强制停止）。
4. 需要管理员权限；默认「只代理列出的」不影响远控等未列出程序，但开关 TUN 的瞬间可能卡一两秒。
5. 堡垒机远控客户端里 PowerShell 的 `$input` 收不到标准输入，用 `[Console]::In.ReadToEnd()` 读。

## 已知问题：不存在的域名解析要等 12 秒（2026-10-15 实测）

电脑 DNS 是公网地址（如 223.5.5.5）时，开着代理查**不存在的域名**，系统解析器要等约 12 秒才返回「不存在」；正常域名、没有 IPv6 地址的域名都不受影响。原因：Windows 对「不存在」要等所有网卡的 DNS 都回答，而 TUN 的 `strict_route` 在 Windows 上会拦掉其它网卡的 DNS，那边一直不回。关掉 `strict_route` 后降到 0.07 秒，但实测仍偶发 10 秒，且会失去防 DNS 泄漏，所以暂未改。DNS 是内网地址（如路由器 192.168.x.1）的电脑不经过内核解析，不受影响。

## 代码位置

- `internal/service/diag.go`：快照、日志缓冲、脱敏、提示
- `internal/service/routetest.go`：路由测试与自检（预期结果规则 `expectRoute` 与 `internal/core` 的路由矩阵测试保持一致）
- `diagapi.go`：HTTP 接口与 MCP 工具
