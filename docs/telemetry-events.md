# 客户端上报事件目录（schemaVersion 1）

这是客户端日志上报的接口标准。三处必须一致：Go `internal/telemetry/catalog.go`（类型常量）、`server/packages/contracts/src/telemetry.ts`（Zod）、本文件。
**规则**：只能新增类型 / 错误码；信封结构变了才升 `schemaVersion`；**永远不改旧类型的含义、不复用旧名字**。payload 只加字段不改字段含义。

## 信封（每个事件都有）
| 字段 | 说明 |
|---|---|
| eventId | 客户端生成的 UUID，服务端按它去重（重传不重复） |
| sessionId | 每次启动软件一个，日志块也带它，可把事件和日志对上 |
| seq | 本次启动内递增序号 |
| ts | 客户端 UTC 时间；超前服务器 10 分钟以上按收到时间记 |
| type / status | 事件类型；ok / fail / info |
| durationMs | 计时操作的耗时 |
| errorCode / errorText | 失败时：归一化错误码 + 原始错误（已脱敏） |
| payload | 类型相关字段（下表），客户端已脱敏 |

批次（POST /v1/client/telemetry，gzip JSON）外层：`schemaVersion, deviceId, appVersion, coreVersion, os, arch, accountHint, events[], logs[]`；
`logs[]` = `{chunkId, sessionId, startedAt, endedAt, lineCount, text}`，text 为脱敏后的原始日志行（应用日志 + sing-box 输出）。

## 事件类型
| type | 何时 | payload | 分析用途 |
|---|---|---|---|
| app.start | 每次启动 | os, arch, admin, locale, freshInstall, background, snapshot | 活跃设备、系统 / 权限分布 |
| app.exit | 正常退出 | — | 区分崩溃与正常退出 |
| app.crash | 捕获到 panic | stack, lastLines | 崩溃定位 |
| app.page_view | 打开主界面某页 | page | 功能使用度 |
| app.update_check | 检查更新 | available, version | 更新通道是否通 |
| app.update | 下载并安排安装 | version | 更新失败率（UPDATE_*） |
| app.update_result | 更新后第一次启动 | from, to, running | 安装回滚检测 |
| proxy.start | 启动代理（界面 / 托盘 / 本机接口 / 更新后恢复） | trigger, capture(tun/split), ruleMode, clashMode, routing, protocol, appRules, customRules, fakeIP, remoteDNS, blockQUIC, lanShare, systemProxy | 启动成功率按版本 / 系统 / 模式 / 协议 |
| proxy.stop / proxy.restart | 用户停止 / 重启 | trigger | 使用习惯、问题前后操作 |
| tun.create | 内核日志 TUN up / TUN 启动失败 | — | 虚拟网卡失败率 |
| core.exit / core.fatal | 内核退出 / FATAL、panic 行 | — | 内核崩溃 |
| core.update | 手动更新内核 | trigger, version | 内核下载问题 |
| net.blocked | 启动后检测到被拦截 | products | 安全软件拦截 |
| node.add | 粘贴导入 / 手动添加 | source, schemes / protocol, added, skipped | 解析失败（PARSE_FAIL） |
| node.remove / node.select | 删除 / 选择节点 | protocol | 协议使用度 |
| node.latency / node.tcp | 单个测速 | protocol, ms（-1 失败） | 各协议测速失败率 |
| node.latency_all | 全部测速 | total{协议:数}, failed{协议:数} | 同上 |
| node.speed | 下载测速 | protocol, mbps | 带宽 |
| sub.add / sub.edit / sub.update / sub.remove | 订阅操作 | host（只留域名）, nodeCount | 订阅拉取失败 |
| app_rule.change | 应用分流列表变更 | added[程序→线路], removed[], total | 最常添加的应用 |
| custom_app.change | 自定义应用 | apps[名称] | 应用库缺口 |
| rule.change | 自定义域名 / IP 规则 | added[类型:值→动作], removed[], total | 规则问题复现 |
| ruleset.change / line.change | 规则集开关 / 线路 | name, enabled / count | — |
| settings.change | 设置保存 | changes{key:{old,new}}（局域网账号密码只记 changed） | 设置与故障相关性 |
| mode.change | 规则模式 / 默认线路 / 分流开关 / clash 模式 / 系统代理 | key, old, new | 同上 |
| diag.self_test / diag.route_test / diag.ai_env / diag.ai_env_fix | 诊断 | cases, failed, hints, dnsLogs / process, url, route / items[] / id | 用户自查结果 |
| account.login / logout / register / redeem | 账号操作 | method | 登录失败率 |
| account.license | 启动时会员状态 | signedIn, authenticated, plan, tier, channel, expiresAt, error | 会员异常 |
| powervpn.nodes | POWER云 线路刷新 | method, kind | 面板可用性 |
| env.security | 启动时 | products[] | 安全软件分布 |
| env.other_vpn | 启动时 | adapters[], ipv6 | 冲突 VPN |
| env.defender | 启动 30 秒后 | status, detections[{threatId, when, files(仅文件名)}], threats | Defender 误报 |

## 错误码（errorCode）
CORE_START_FAIL, CORE_EXIT, TUN_CREATE_FAIL, CORE_BLOCKED_AV, DNS_FAIL, NODE_TIMEOUT, NODE_AUTH_FAIL, NODE_UNREACHABLE, TLS_FAIL, PARSE_FAIL, SUB_FETCH_FAIL, NO_NODE, PORT_IN_USE, PERMISSION_DENIED, CONFIG_INVALID, LICENSE_DENIED, NETWORK_FAIL, UPDATE_DOWNLOAD_FAIL, UPDATE_VERIFY_FAIL, PANIC, UNKNOWN。
映射规则在 `internal/telemetry/errcode.go`（关键字，先具体后笼统；没命中按事件类型给默认码），原始文本始终保留在 errorText。
