# 本机日志文件（分支 feat/log-files，2026-10-29，未发版）

## 以前的情况
- `Service.log` 只进内存环 `logRing`（diag.go，「日志与诊断」页读它）+ 界面回调 + telemetry 上传队列（`%APPDATA%/proxysplit/telemetry/`，是待上传的段，不是给人看的日志）。磁盘上没有可读的运行日志。

## 现在
- 每一行 `Service.log`（应用日志 [service]/[subs]/[update]/[sync]/[account]…，以及 sing-box 输出）同时写 `<配置目录>/proxysplit/logs/proxysplit-YYYY-MM-DD.log`（按本地日期；Windows `%APPDATA%\proxysplit\logs`，macOS `~/Library/Application Support/proxysplit/logs`）。
- 代码：`internal/logfile`（writer.go 缓冲 + 互斥、logfile.go 格式 / 清理 / 天数、phone.go 手机号打码）；接线在 `internal/service/logfiles.go`（New 第一步 openLogFiles，Close 时刷盘）。
- 行格式：`2026-10-29 14:03:12.345 INFO  [service] 文本`。级别按文本猜（ERROR/FATAL/失败/ failed → ERROR，WARN，DEBUG/TRACE，其余 INFO）；没有 `[分类]` 开头的行是内核输出，补 `[core]`。
- 脱敏：写盘前过 `telemetry.Sanitize`（分享链接、令牌、密码、UUID、长密钥串、邮箱）+ 手机号只留前 3 后 2（telemetry 的 Sanitize 不管手机号，所以在 logfile 里补）。
- 写法：内存缓冲，每 2 秒或攒够 64 KB 就「打开 → 追加 → 关闭」，不长期占着文件句柄（Windows 下用户可以随时打开 / 删除，单测的临时目录也能清掉）。写失败直接丢弃缓冲，不涨内存。
- 单个日文件 50 MB 封顶：到顶写一行「日志已达当天 50 MB 上限…」，当天后面的不再写；重启后看到当天文件已满也不再写。
- 保留：`Settings.LogDays`（json `logRetentionDays`，omitempty，零值 / 老配置没这个字段 = 7，SetSettings 夹到 1–30）。启动时、每天第一次写 / 刷盘时、改设置时各清一次：只删名字符合 `proxysplit-YYYY-MM-DD.log` 且日期早于「含今天的最近 N 天」的文件。
- 连接记录：运行中每 60 秒取一次 `s.Connections()`（和「连接」页同一来源，进程名是 ConnInfo.Process），只写上一轮没有的连接 id：`[conn] chrome.exe → 香港 01 → www.google.com:443 rule=process_name chrome.exe`（非 tcp 加 ` net=udp`）。每轮最多 500 行，多出的写一行汇总。**只进日志文件**，不进界面日志环、不上传（量太大）。
- 界面：日志与诊断 → 诊断：「日志保留天数」（1–30，默认 7，离开输入框保存）、「打开日志文件夹」（App.OpenLogDir：Windows explorer、macOS open）。

## 示例
```
2026-10-29 09:00:01.120 INFO  [service] core started (tun, 3 rules)
2026-10-29 09:00:01.480 INFO  [core] INFO[0001] inbound/tun[tun-in]: started at fdfe::1
2026-10-29 09:00:03.902 ERROR [subs] auto-update 主订阅 failed: Get "https://sub.example.com/[redacted]": timeout
2026-10-29 09:01:00.004 INFO  [conn] chrome.exe → 香港 01 → www.google.com:443 rule=process_name chrome.exe
2026-10-29 09:01:00.004 INFO  [conn] WeChat.exe → 直连 → weixin.qq.com:443 rule=geosite cn
2026-10-29 09:02:10.311 INFO  [account] 短信登录 138******78
```

## 服务端
- 上传日志的服务端保留默认从 15 天改为 7 天（`TELEMETRY_RETENTION_DAYS`，server/apps/api/src/app.ts）；生产 env 若显式写了 15 要一起改。
