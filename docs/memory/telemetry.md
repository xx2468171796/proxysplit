# 客户端日志全量上报（telemetry）

> 事件目录 / 错误码标准：docs/telemetry-events.md（扩展只加不改）。

## 链路
- 客户端 `internal/telemetry`：Service.log 每一行（应用日志 + sing-box 输出）经 `SetLogTap`（internal/service/telemetry_tap.go）进磁盘队列 `%APPDATA%/proxysplit/telemetry/`（256 KB 一段、总量 20 MB、超了删最旧；崩溃留下的 cur-* 下次启动封段）。事件用 `telemetry.Emit/Op/Note`，各绑定的埋点都是一行（根目录 telemetry_app.go 的 tm* 助手）。
- 脱敏在写盘前做（sanitize.go，有单测）：分享链接（含 socks/socks5h/socks4 等）→ `scheme://[redacted]`；http(s)/ws(s) 链接一律只留 `scheme://host[:port]`，有路径 / 查询 / 账号就变成 `scheme://host/[redacted]`（订阅链接路径里有令牌，Go 的 `Get "https://host/link/xxx": …` 错误文本也会被处理）；其他任意 scheme 的 URL 账号密码 → `[redacted]@`；password/secret/token/uuid/psk/private_key/public_key/short_id/auth 等键值、Authorization / Bearer、JWT、UUID、≥32 位 base64/hex 串 → 打码，邮箱 → `a***@域名`。域名、IP、端口、进程名、错误文本保留。payload 里 server / link / password 等键整值丢弃。tmErr / tmText 走 emit，错误文本必过 Sanitize。
- accountHint 由 `telemetry.MaskAccount` 打码（邮箱 a***@域名、手机前 3 后 2、其他前 2 位 + ***）；diag.route_test 只报测试网址的 host；snapshot.capture = global（整机 TunMode）| tun（虚拟网卡分流）| process（仅接管选中程序）。
- Close：取消上传 context，最多等 2 秒（写盘循环 + 正在跑的上传一起算）就返回。
- 上传：每 60 秒、失败事件立即；一段一个请求、gzip；失败指数退避 30 s → 30 min（±20% 抖动）；400/413 丢段。走 `license.DirectTransport()`（钉 SPKI、禁用代理），API 域名本来就在内核直连名单。
- 设备号 = sha256("proxysplit-device-v1:"+指纹) = 服务端 `devices.fingerprint_hash`；有登录令牌就带上（服务端核实出账号），过期也照收。
- 关闭：环境变量 `PROXYSPLIT_TELEMETRY=off`；开发版（没注入 license.APIURL）本来就不开。不给用户开关（老板要求），设置 → 内核与更新里有中文告知。

## 服务端
- `POST /v1/client/telemetry`（nginx 只转 /v1/，所以不是 /api/）：Zod 校验，压缩前 ≤ 512 KB（TELEMETRY_MAX_GZIP_BYTES）、解压后 ≤ 4 MB（客户端一段 256 KB），每 IP 240 次/分 + 每设备 30 次/分（进程内计数）+ 每 IP 每 10 分钟解压后 20 MB（TELEMETRY_IP_BYTES_PER_10MIN；telemetry-budget.ts，有 REDIS_URL 用 Redis，否则 / 出错退回进程内）。
- 防冒充：设备号谁都能报。只有「设备还没绑账号」或「令牌账号 = 设备已绑账号」时才写设备行（版本 / IP / 状态 / accountHint）、绑账号，账号一旦绑上不会被别的令牌换掉；否则只累加计数，事件 / 日志照收但 `unverified=true`、account_id 置空。没登录发的数据也标 unverified。排查时优先看 unverified=false。一批一个事务、每表一条 INSERT … jsonb_to_recordset，eventId / chunkId 去重。
- 表（迁移 0016）：client_devices（最近版本 / 系统 / 账号 / 最近启动结果）、client_events（类型化 + jsonb + unverified）、client_log_chunks（日志块，TOAST 压缩 + unverified）。unverified 列是在 0016 未上线前直接加进 0016 的；0016 一旦上线，再改表必须新开 0017。
- 保留：API 进程每小时清一次 `TELEMETRY_RETENTION_DAYS`（默认 15）天前收到的数据，每表每轮最多 20×5000 行。其他 env：TELEMETRY_MAX_GZIP_BYTES、TELEMETRY_PER_DEVICE_PER_MINUTE。
- 后台「客户端日志」：设备 / 最近失败 / 统计分析；接口 `/v1/admin/telemetry/{devices,devices/:id,devices/:id/events,devices/:id/logs,failures,analytics}`。

## AI 排查：堡垒机数据源 sz-pg-proxysplit（只读查询）
```sql
-- 按账号找设备
SELECT d.device_id,d.app_version,d.os,d.last_status,d.last_error_code,d.last_seen FROM client_devices d JOIN users u ON u.id=d.account_id WHERE u.username='xxx';
-- 某设备最近事件
SELECT ts,type,status,error_code,error_text,payload FROM client_events WHERE device_id='<64位>' ORDER BY ts DESC LIMIT 100;
-- 某设备某时间段日志（窗口别开太大）
SELECT started_at,text FROM client_log_chunks WHERE device_id='<64位>' AND started_at>now()-interval '1 day' ORDER BY started_at DESC LIMIT 20;
-- 按错误找人：最近 3 天 TUN 失败的设备
SELECT device_id,count(*),max(ts) FROM client_events WHERE status='fail' AND error_code='TUN_CREATE_FAIL' AND ts>now()-interval '3 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 50;
-- 日志全文（限设备 + 时间窗，不要全表 ILIKE）
SELECT started_at,text FROM client_log_chunks WHERE device_id='<64位>' AND started_at>now()-interval '6 hours' AND text ILIKE '%wintun%';
```

### 连接成败汇总（net.conn_summary，v1.10.1 起）
```sql
-- 某设备最近的连接汇总（先看这个，再决定翻哪段日志）
SELECT ts,status,payload->>'total' total,payload->>'failed' failed,payload->'failures' failures,payload->'kinds' kinds,payload->>'v6Failures' v6,payload->'top' top
FROM client_events WHERE device_id='<64位>' AND type='net.conn_summary' ORDER BY ts DESC LIMIT 12;
-- 全网最近 24 小时连接失败严重的设备（按失败数）
SELECT device_id,count(*) windows,sum((payload->>'failed')::int) failed,sum((payload->>'total')::int) total
FROM client_events WHERE type='net.conn_summary' AND status='fail' AND ts>now()-interval '1 day' GROUP BY 1 ORDER BY 3 DESC LIMIT 30;
-- 各失败原因的分布（看新版本是否引入回归：按 app_version 对比）
SELECT d.app_version,k.key kind,sum(k.value::int) n FROM client_events e JOIN client_devices d USING(device_id), jsonb_each_text(e.payload->'kinds') k
WHERE e.type='net.conn_summary' AND e.ts>now()-interval '3 days' GROUP BY 1,2 ORDER BY 1 DESC,3 DESC;
```
- 判读：proxy 出站大量 timeout = 节点不通 / 被封；v6Failures 高 = IPv6 问题；dns 多 = 解析问题；direct 出站 refused / reset = 安全软件或运营商拦截。确定方向后再按时间窗翻 client_log_chunks。

## 体量估算
info 级日志每台每天约 1–5 千行（约 0.2–0.8 MB 原文，gzip 后 30–120 KB 上行）；事件约 100–500 条（每条约 0.4 KB）。debug 级可到 10 倍，客户端 20 MB 封顶。1000 台活跃 × 15 天 ≈ 5–15 GB 原文，PG TOAST 压缩后约 1/3。
