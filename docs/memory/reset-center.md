# 清除与重置中心

> 代码：internal/service/reset.go（登记表 + 执行）、reset_catalog.go（清单）、reset_net.go、reset_config.go；宿主 app_reset.go；界面 frontend/src/features/settings/reset/；审计 docs/ui-audit-2026-10.md。

## 入口
设置 →「维护 / 清除与重置」是唯一位置；托盘「清除与重置…」发 `open-settings` 事件跳过来；诊断接口 `GET/POST /api/reset {"items":[...],"confirm":"确认重置"}`。

## 清单（id → 做法）
- 缓存：core-dns-cache（clash API POST /cache/dns/flush + /cache/fakeip/flush，失败才重启内核；内核没有 cache_file）、noderesolve-cache / dns-prewarm（预留，`service.RegisterResetter` 登记后才可用）、windows-dns-cache（aiguard.FlushCache = dnsapi DnsFlushResolverCache，不动 NRPT）、rulesets（UpdateRuleSets → geoupdate.Update）、log-spool（宿主：telemetry.FlushAndPurge 先上传 20 秒再删 spool）。
- 网络修复：sysproxy（clearOSProxy）、strays（停端口与内核 → CleanStrays / KillPortStrays / CleanProbeStrays → 原来在跑的重启）、binaries（宿主：Xray 按 pin 校验，坏了先装内置再下载；WinDivert 只在下载过时 EnsureWinDivert）。
- 配置重置（先备份 <数据目录>/backups/reset-*.json，保留 5 份，「撤销上次重置」= ImportAll 最新一份并删掉它）：node-cores、routing、app-rules、all-settings（保留节点 / 订阅 / 端口代理 / 自定义应用 / API 令牌）、factory（要输入「确认重置」；先走 Service.Stop 再清空，只留 API 令牌与系统代理标记）。

## 红线
任何一项都不关 AI 劫持、不删 <数据目录>/ai-hijack、不动 NRPT、不动 aienv-state.json、账号与授权文件；恢复出厂经 Stop()（lockAIBeforeStop 先锁）。reset_test.go 钉死 ai-hijack 文件不变。

## 遥测
reset.run（items, ok, failed, ms, backup）、reset.undo；服务端 contracts telemetry.ts 已加类型。
