# 清除与重置中心

> 代码：internal/service/reset.go（登记表 + 执行）、reset_catalog.go（清单）、reset_net.go、reset_config.go；宿主 app_reset.go；界面 frontend/src/features/settings/reset/；审计 docs/ui-audit-2026-10.md。

## 入口
设置 →「维护 / 清除与重置」是唯一位置；托盘「清除与重置…」发 `open-settings` 事件跳过来；诊断接口 `GET/POST /api/reset {"items":[...],"confirm":"确认重置"}`。

## 清单（id → 做法）
- 缓存：core-dns-cache（有持久缓存 dns-cache.db 时停内核删文件再启动；否则 clash API POST /cache/dns/flush + /cache/fakeip/flush，失败才重启内核）、noderesolve-cache（清 noderesolve 进程内缓存）/ dns-prewarm（清内存里的常用域名表并删 dnswarm.json）——两项由 service.New 里 registerCacheResetters 登记（reset_caches.go）、windows-dns-cache（aiguard.FlushCache = dnsapi DnsFlushResolverCache，不动 NRPT）、rulesets（UpdateRuleSets → geoupdate.Update）、log-spool（宿主：只删不传 —— `telemetry.Purge` 直接删掉正在写的段、已封的段和隔离的 bad-* 段，2026-11-18 审计改；旧的 FlushAndPurge 已删）。
- 网络修复：sysproxy（clearOSProxy）、strays（停端口与内核 → CleanStrays / KillPortStrays / CleanProbeStrays → 原来在跑的重启）、binaries（宿主：Xray 按 pin 校验，坏了先装内置再下载；WinDivert 只在下载过时 EnsureWinDivert）。
- 配置重置（先备份 <数据目录>/backups/reset-*.json，保留 5 份，「撤销上次重置」= ImportAll 最新一份并删掉它）：node-cores、routing、app-rules、all-settings（保留节点 / 订阅 / 端口代理 / 自定义应用 / API 令牌）、factory（要输入「确认重置」；先走 Service.Stop 再清空，只留系统代理标记；**AI 控制令牌换新的**，撤销也不会把旧令牌带回来）。
- 导入配置 / 撤销（ImportAll → validateImportedConfigLocked）：除引用校验外再过界面表单的字段校验（`Net.validate`、每个端口代理 `normalizePortFields` + 编号 / 端口号不重复、每个订阅 `normalizeSubOptions`），表单拒绝的值配置文件也带不进来；软件自己会存下来的状态不拒绝（否则重置备份 / 云同步恢复不了）：端口钉着的节点已被删掉 → 改为跟随当前节点，端口号等于局域网共享端口 → 保留；文件里的 apiToken 一律忽略，令牌只认本机现有的。

## 红线
任何一项都不关 AI 劫持、不删 <数据目录>/ai-hijack、不动 NRPT、不动 aienv-state.json、账号与授权文件；**不删 device.dat（设备指纹，丢了要多占一个设备名额）和 control-api.json**；恢复出厂经 Stop()（lockAIBeforeStop 先锁）。reset_test.go 钉死 ai-hijack、device.dat、control-api.json 不变。

## 遥测
reset.run（items, ok, failed, ms, backup）、reset.undo；服务端 contracts telemetry.ts 已加类型。
