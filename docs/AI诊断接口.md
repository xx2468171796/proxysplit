# AI 诊断与测试接口

ProxySplit 内置一组诊断接口，让 AI（或工程师）在任何一台装了客户端的电脑上，直接查看分流状态、真实测试某个程序访问某个网站走了哪里。排查「某网站打不开 / 规则不生效」时先用它，不要靠猜。

## 怎么连

- 地址：`http://127.0.0.1:18088`，只监听本机（远程机器经堡垒机 `run_command` 在那台机器上调用）。
- 鉴权：只认请求头 `Authorization: Bearer <token>`。**网址里的 `?token=` 不再接受**（令牌进了网址会留在历史记录和日志里）。token 在软件「AI → AI 控制」里复制，也在 `%APPDATA%\proxysplit\config.json` 的 `apiToken`。
- 换令牌：「AI 控制」里点「重新生成令牌」，旧令牌立刻失效（每个请求现读，不用重启）。粘贴过提示词的 AI 工具要重新复制一次；`--mcp` 方式每次调用自己读新令牌，不用改。恢复出厂也会换令牌；导入别人的配置文件不会改动本机令牌。
- 只接受本机直接发来的请求：`Host` 必须是 `127.0.0.1` / `localhost`（否则 403），带 `Origin` 头的请求一律 403（浏览器网页不能调用）。用 curl、PowerShell 或 MCP。
- 读用 GET，改用 POST：GET 不会改任何东西；**POST 必须带 `Content-Type: application/json`**，没有参数也要发 `{}`（否则 415）；请求体最大 1 MB（超了 413）；方法不对 405。
- 测试机上有现成脚本 `C:\ProgramData\ps-diagrun\psapi.ps1`：`& psapi.ps1 GET /api/diag`、`& psapi.ps1 POST /api/nodes/via '{"id":"…","via":"…"}'`（自己读 token；含密码的请求体用 `-Stdin`）。脚本要符合上面两条（Bearer 头、POST 带 JSON 类型和 `{}`）。
- MCP：同样的能力挂在 `POST /mcp`（JSON-RPC 2.0）和 `proxysplit.exe --mcp`，工具名见下表。HTTP 和 MCP 调的是同一组操作（apiops.go），返回内容一样。
- `GET /api/hello?challenge=<32–128 位十六进制随机串>`：唯一不用令牌的接口，返回 `{"app":"proxysplit","proof":"…"}`。`--mcp` 桥用它确认 18088 上真的是本程序，再把令牌发过去：程序启动监听后在数据目录写 `control-api.json`（端口、进程号、随机数），proof = HMAC-SHA256(随机数, "proxysplit-hello\0" + challenge)，读不到数据目录的程序算不出来。这个文件随程序退出删除，任何重置都不会动它。

## 返回内容里没有密钥

接口和 MCP 工具的任何返回都不含节点密码 / UUID / 分享链接 / 订阅地址 / 局域网与端口代理密码 / 控制令牌：

- 节点列表只有 `id、name、type、server、port、official、via、selected`。
- 设置里的局域网密码显示为 `***`；把读到的设置整个 POST 回去时，`***` 表示「不改」。
- `/api/diag` 的内核配置按字段名打码（password、uuid、private_key、private_key_passphrase、plugin_opts、short_id、username 等，名单与日志脱敏是同一份：`internal/telemetry/sanitize.go`）；Reality 的 `public_key` 保留。
- 日志、路由测试、自检结果里引用的内核日志先过日志脱敏：分享链接 → `scheme://[redacted]`，网址只留域名，UUID / 长串 / 手机号 / 用户目录里的用户名打码。域名、IP、端口、进程名、报错原文保留，够排查用。
- 每加一个接口或工具都要过泄漏扫描测试（`apileak_test.go`），否则测试不过。

## 返回约定

- 写操作成功 `{"ok":true}`；业务上失败 `{"ok":false,"error":"中文原因"}`（HTTP 仍是 200）。
- 请求体不对 400 `{"error":"…"}`；token 不对 401；Host / Origin 不对 403；方法不对 405；POST 没带 JSON 类型 415；请求体超 1 MB 413；内核启动失败等 500 `{"error":"…"}`。
- 改设置 / 节点 / 规则后，代理在运行时会自动重启内核（几秒），不用再调 restart。

## 接口一览

### 状态与启停
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/status` | — | `{running, node, nodeId, mode(rule/global/direct), apps[]}` | `proxysplit_status` |
| `POST /api/start` / `POST /api/stop` / `POST /api/restart` | `{}` | `{ok}` | `proxysplit_start` / `proxysplit_stop` |
| `POST /api/mode` | `{"clash":"rule\|global\|direct"}` | `{ok, mode}`；代理策略，切换不重启 | `proxysplit_set_mode` |
| `POST /api/split-mode` | `{"mode":"whitelist\|blacklist"}` | `{ok}`；whitelist = 只代理列出的应用，blacklist = 默认全走代理 | `proxysplit_set_split_mode` |

### 节点
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/nodes` | — | `[{id, name, type, server, port, official, via, selected}]`（不含任何凭据） | `proxysplit_list_nodes` |
| `POST /api/nodes/add` | `{"text":"每行一个分享链接，或整份 WireGuard .conf"}` | `{added, skipped, …}` | `proxysplit_add_nodes` |
| `POST /api/nodes/remove` | `{"id"}` | `{ok}` | — |
| `POST /api/node/select` | `{"id"}` | `{ok}`；手动切换活动节点（没有自动选择） | `proxysplit_select_node` |
| `POST /api/nodes/core` | `{"id","core":"auto\|sing-box\|xray"}` | `{ok}`；指定节点内核 | — |
| `POST /api/nodes/via` | `{"id","via":"<前置节点 id，空 = 关闭>"}` | `{ok}`；前置代理：先连 via 再连 id，出口 IP 仍是 id。只支持一层；官方线路 / Xray / 整组导入的不支持 | `proxysplit_set_node_via` |

### 应用分流与规则
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/apps` | — | 应用规则列表 | `proxysplit_status` |
| `POST /api/apps` | `{"match":"chrome.exe","path":"","line":"rule\|global\|direct\|block\|<线路 id>","node":"","enabled":true}` | `{ok, apps[]}`；有则改、无则加 | `proxysplit_set_app` |
| `POST /api/apps/remove` | `{"match"}` | `{ok, apps[]}` | `proxysplit_remove_app` |
| `GET / POST /api/custom-rules` | `{"rules":[{"type":"suffix\|domain\|keyword\|ip","value":"x.com","action":"proxy\|direct\|block"}]}` | 整体替换 | `proxysplit_set_custom_rules` |

### 设置
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET / POST /api/settings` | 只传要改的字段，如 `{"captureMode":"process"}`、`{"tunMode":true}`、`{"blockQUIC":false}` | `{ok}`；GET 时局域网密码打码 | `proxysplit_set_settings` |
| `GET / POST /api/settings/net` | `{"dnsDirect":"223.5.5.5","dnsRemote":"8.8.8.8","hosts":"nas.home 192.168.1.10","blockHttpsRR":false,"tunMtu":0,"strictRouteOff":false}`（整体替换，`{}` = 全部默认） | `{ok}` 或 `{ok:false,error:"DNS 服务器要填 IP 地址：…"}`；DNS 只收 IP，MTU 0 或 1280–9000 | `proxysplit_set_dns` |
| `POST /api/log-level` | `{"level":"info\|debug\|warn"}` | `{ok}`；路由测试要 info 或 debug | — |

### 诊断
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/diag` | — | 诊断快照：版本、运行状态、模式、节点（不含密码）、应用规则、规则库、设置、当前内核配置（密钥脱敏）、节点保活、安全软件、提示 | `proxysplit_diagnose` |
| `POST /api/diag/route-test` | `{"process":"chrome.exe","url":"https://www.google.com"}` | `{ok, httpCode, seconds, route(direct/node/reject/unknown), hops[], error}` | `proxysplit_route_test` |
| `POST /api/diag/selftest` | `{}` | 每个列出的应用（最多 6 个）和一个未列出的程序访问百度 / QQ / Google / YouTube，对比「应该」的结果；约 1 分钟 | `proxysplit_selftest` |
| `GET /api/diag/logs?n=300&grep=baidu` | — | 最近日志（含内核，已脱敏） | `proxysplit_logs` |
| `GET /api/exits` | — | 实时出口：本机直连 / 分应用代理 / AI 线路的 IP、地区、类型 | — |

### AI 相关
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/ai-hijack` | — | AI 劫持状态（只读：解除只能在软件界面里点「恢复」，接口不提供） | — |
| `GET /api/ai-env` | — | AI 环境检测（出口、时区、时间、守护等） | — |
| `POST /api/ai-env/fix` | `{"id":"guard\|timezone\|clock\|autostart\|all"}` | `{ok}` | — |

### 账号与维护
| 方法 路径 | 请求体 | 返回 | MCP 工具 |
|---|---|---|---|
| `GET /api/account` | — | ProxySplit 账号与 POWER云 状态 | `proxysplit_account` |
| `POST /api/account/login` | `{"username","password"}`（经标准输入传，别写进命令行） | `{ok}` | — |
| `GET /api/reset`；`POST /api/reset` | `{"items":["core-dns-cache",…],"confirm":"确认重置"}`（恢复出厂才要 confirm） | 清除与重置中心；任何一项都不解除 AI 劫持 | `proxysplit_reset` |
| `POST /api/reset/undo` | `{}` | 恢复最近一份重置前备份（不会把恢复出厂前的旧令牌带回来） | `proxysplit_reset_undo` |

### 常用操作配方
- **看某台电脑现在怎样**：`GET /api/diag` → 看 `running`、`node`、`settings.captureMode`、`nodeHealth`、`hints`。
- **某网站打不开**：`POST /api/diag/route-test` 用出问题的程序名测一次 → 看 `route` 和 `hops`；再 `GET /api/diag/logs?grep=<域名>`。
- **验证前置代理**：`POST /api/nodes/via` → `POST /api/node/select` 选这个节点 → `GET /api/exits` 看 `proxy.ip` 应是目标节点的 IP。
- **测完还原**：把改过的设置 / 前置 / 节点改回去，`/api/settings/net` 传 `{}`。

### 节点与订阅清单（内部）
客户端会把本机全部节点和订阅（含完整链接）上报服务器，后台「同事节点」可查：见 [节点上报.md](节点上报.md)。这一项不写进任何用户能看到的说明。

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
Invoke-RestMethod http://127.0.0.1:18088/api/diag/selftest -Method Post -Headers $h -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:18088/api/diag/route-test -Method Post -Headers $h -ContentType 'application/json' -Body '{"process":"chrome.exe","url":"https://www.baidu.com"}'
```

## 不登录的远程测试：cmd/diagrun

装了正式版但登录不方便（比如别人正在用那台电脑）时，用 `cmd/diagrun` 在那台机器上直接跑同一套分流代码和真实内核（TUN），不需要界面、不需要登录：

1. 本机 `go build -o diagrun.exe ./cmd/diagrun`，和 `bin\sing-box.exe` + 三个 `.srs` 一起放到目标机，例如 `C:\ProgramData\ps-diagrun\`（exe 旁边一个 `bin` 目录）。
2. 节点链接含密码，**只经标准输入传入**：先把链接写进临时文件，再 `cmd /c "diagrun.exe -link - -mode whitelist -app chrome.exe=rule < link.txt"`，跑完立刻删掉链接文件和 `%TEMP%\proxysplit-diagrun`（里面的配置也有密码）。
3. 常用参数：`-mode whitelist|blacklist|tun`、`-clash rule|global|direct`、`-app 名称=线路`（可多个）、`-custom 类型:值:动作`（可多个）、`-test 程序=网址`（可多个）、`-cold 15s`（启动后立刻持续测 DNS）、`-loglevel debug`、`-limit 4m`（到时强制停止）。
4. 需要管理员权限；默认「只代理列出的」不影响远控等未列出程序，但开关 TUN 的瞬间可能卡一两秒。
5. 堡垒机远控客户端里 PowerShell 的 `$input` 收不到标准输入，用 `[Console]::In.ReadToEnd()` 读。

## 安全软件拦截（火绒、360 等）

分流模式下所有流量（包括直连的国内网站）都由内核 `sing-box.exe` 发出，安全软件不信任它时，开代理后**所有网站都打不开**，关掉就好。软件现在会识别正在运行的安全软件（火绒、360、腾讯电脑管家、金山毒霸、2345、卡巴斯基、ESET、诺顿）：

- `/api/diag` 的 `security` 字段列出检测到的产品，`hints` 里给出放行方法（信任 proxysplit.exe 和数据目录 `bin\sing-box.exe`）。
- 一键自检里「国内网站已按规则直连却连不上」会单独提示：不是分流规则问题，是本机拦截。
- 启动代理失败时，错误信息后面附上同样的提示。

## 已知问题：不存在的域名解析要等 12 秒（2026-10-15 实测）

电脑 DNS 是公网地址（如 223.5.5.5）时，开着代理查**不存在的域名**，系统解析器要等约 12 秒才返回「不存在」；正常域名、没有 IPv6 地址的域名都不受影响。原因：Windows 对「不存在」要等所有网卡的 DNS 都回答，而 TUN 的 `strict_route` 在 Windows 上会拦掉其它网卡的 DNS，那边一直不回。关掉 `strict_route` 后降到 0.07 秒，但实测仍偶发 10 秒，且会失去防 DNS 泄漏，所以暂未改。DNS 是内网地址（如路由器 192.168.x.1）的电脑不经过内核解析，不受影响。

## 代码位置

- `internal/service/diag.go`：快照、日志缓冲、脱敏、提示
- `internal/service/routetest.go`：路由测试与自检（预期结果规则 `expectRoute` 与 `internal/core` 的路由矩阵测试保持一致）
- `diagapi.go`：HTTP 接口与 MCP 工具
