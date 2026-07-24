# ProxySplit 项目状态



## 当前发布
- 2026-07-24：会员等级规则已统一并发布 v1.9.25：普通会员与超级会员支持完全相同的协议、应用分流、自定义线路和完整功能，只按同时在线设备数区分（普通会员 3 台、超级会员 8 台）。客户端已删除协议与自定义线路的等级门槛，两个会员中心对比表和套餐说明已同步；生产库所有活动套餐 features 统一为 `["proxy","rules","custom-lines","all-protocols"]`，公开套餐 API 已核验只有设备数差异。
- v1.9.25 正式产物大小 `80,910,848` 字节，SHA256 `84759049be328c9751233eb219c1fb2d5f06d635d2726e05fbb576adddc5b3e1`；线上发布记录、下载文件和官网版本一致。当前静态发布目录 `/opt/proxysplit/releases/20260724-163128-ff22bae`，本机真实启动目标已替换并启动为 1.9.25。
- 2026-07-24：陈旧授权缓存已按“跨版本永久兼容”方案收口并发布 v1.9.24：`license.dat` 增加显式 `schemaVersion`，v1.9.23 及以前的无版本缓存自动迁移；比当前客户端更新的未来缓存在降级运行时保持原样、不被覆盖；DPAPI 解密失败、JSON 损坏或非法版本会自动隔离为带时间戳的 `.corrupt-*.bak`。每次应用启动会在首屏快照前用 4 秒上限向服务端轮换并核验刷新令牌，明确 4xx 会清除在线伪登录但保留独立签名的离线租约，网络故障则完全保留缓存。
- v1.9.24 回归覆盖：旧缓存迁移持久化、未来版本降级保护、服务端撤销会话清理、网络故障缓存保留、离线租约不被误删；`go test ./...`、前端检查与构建均通过。正式产物大小 `81,111,040` 字节，SHA256 `175139c9ca73f607f968df485caa9cf99eeacdf3652653c3ff3f9f779d677c4c`，线上发布及下载校验一致；当前静态发布目录 `/opt/proxysplit/releases/20260724-152812-955c5ff`，本机真实启动目标已替换并启动为 1.9.24。
- 2026-07-24：设备列表显示 0 台的根因已确认并修复：生产库实际存在有效设备 `TOP-011913S11`，但本机 `license.dat` 仍保存一个已被服务端撤销的旧设备 ID；访问令牌到期后刷新会话返回 401，旧客户端却继续把缓存租约显示成“已登录”，并把设备接口错误隐藏成空列表。v1.9.23 现会在服务端明确拒绝陈旧刷新令牌时清除伪登录状态（保留有效离线租约），设备读取失败会显示明确的“退出并重新登录”提示，不再伪装成 0 台。
- 正式客户端 `v1.9.23`：大小 `80,470,528` 字节，SHA256 `db0ea6840bbcd6b719604e827cc99c404c1a4fb97ba6b5b3ce6074c151c42b58`；服务端发布记录、正式下载和官网均已切换。当前静态发布目录为 `/opt/proxysplit/releases/20260724-151434-23edaa0`。本机陈旧凭据已可逆移至 `license.dat.stale-20260724-1512.bak`，真实启动文件已替换并启动为 1.9.23，用户只需重新登录一次即可重新读取服务端设备。
- 2026-07-24：ProxySplit 新品牌图标已设计并全量替换：核心视觉为“单路输入、双路分流”，深海军蓝底配电光蓝/青色路线；Windows EXE/任务栏/托盘、客户端侧栏、官网品牌标识与 favicon 已统一。正式客户端升级为 `v1.9.22`，产物大小 `80,585,728` 字节，SHA256 `48484bc79aa32e63fa73bab99bb9649d7ecf4e8cfd072df973dd7563eb51720a`，线上发布记录与下载文件已校验一致。
- 当前服务端静态发布目录：`/opt/proxysplit/releases/20260724-150301-bb07ba8`；官网已展示新图标及 v1.9.22 下载，首页仍无后台管理入口，API 健康检查正常。
- 2026-07-24：官网与后台入口整理完成并已上线：官网桌面导航、移动导航、页脚均不再展示 `/admin/` 管理入口，面向普通用户的文案不再出现“运营后台”；管理后台登录用户名初始值已清空，增加明确占位提示与必填校验。
- 当前服务端静态发布目录：`/opt/proxysplit/releases/20260724-144926-d9da30a`；线上首页无 `/admin/` 引用，API 健康检查正常。正式下载版本仍为 `v1.9.21`，线上文件大小 `80,535,040` 字节，SHA256 `9071088b1cbac0efc17be951014aa92974bc7f7e91061365b113caef84d1a6f1`，与发布记录一致。
- 2026-07-24：设备解绑无效根因已确认：客户端对无请求体的 DELETE 仍发送 `Content-Type: application/json`，Fastify 在路由前将其拒绝为空 JSON，生产日志中两次真实解绑均为 HTTP 500。服务端现兼容旧请求，新客户端不再发送错误请求头；修复版本为 `v1.9.21`，源码提交 `b0e97d759b480a1f8e36cd4957c41cea14fde730`。
- 服务端当前部署：`/opt/proxysplit/releases/20260724-143013-b0e97d7`；API、PostgreSQL、Redis 均 healthy，旧版 1.9.20 客户端的空 DELETE 已验证可进入正常认证路由。

- 客户端产物：`output/proxysplit-v1.9.21.exe`，大小 `80,535,040` 字节，SHA256 `9071088b1cbac0efc17be951014aa92974bc7f7e91061365b113caef84d1a6f1`；正式下载和 `/v1/releases/latest` 已切至 1.9.21。

- 用户两次尝试解绑的设备 `alone公司电脑` 已按明确操作记录完成解绑，生产库仅保留当前 `TOP-011913S11` 设备，后台审计记录为 success；本机已启动 1.9.21 并验证窗口标题和 ProductVersion。

- 第三轮“支付 / 认证 / 客户端”多智能体对抗审计修复包含在 1.9.21 中，基础修复提交为 `322c4f4bff26ca54ff0b3d1e251023f86f0ef506`。

- 本机曾仍从 `C:/Users/Administrator/Downloads/Programs/proxysplit-v1.9.19.exe` 启动，所以标题显示 1.9.19；这不是 1.9.20 构建错误。已备份旧文件、把该真实启动目标原地替换为 1.9.20 并重启，窗口标题与文件 ProductVersion 均已实测为 1.9.20。

- 完整验证通过：`go test ./...`、`go vet ./...`、前端 `npm run check/build`、服务端 `pnpm typecheck/test/build`；服务端共 20 项测试（core 18 + API 2），前端 0 error / 0 warning。



## 本轮关键修复

- 支付到账：同一用户同等级首次并发到账增加事务 advisory lock，避免生成两条并行权益而丢失一段时长；付款事件、订单和权益继续在同一事务幂等落地。

- 补偿对账：失败订单 7 天内每 5 分钟继续回查；历史订单即使支付通道停用也能查单；网关真实 `paid_at` 落库；创建订单与极速回调竞态按已付款成功处理。

- 客户端到账恢复：关闭付款窗口或重启后，只要订单已付且本机尚无有效租约，会自动刷新权益；付款轮询改为 single-flight。

- 防止重复扣单：认证请求仅在 HTTP 401 时刷新并重试，超时或 5xx 不再自动重放 `POST /v1/orders`；轮换后的单次 refresh token 立即持久化。

- 认证与设备：访问令牌每次请求实时复核账号状态、数据库角色和设备撤销状态；pending 换机令牌只允许查看、解绑和激活设备；refresh 轮换改为数据库行锁事务；套餐设备数降额后禁止超额设备继续取租约。

- 套餐一致性：部分 PATCH 合并后重新校验永久标记、周期和有效天数；已有订单或授权引用的套餐禁止修改等级、周期、设备数和权益，防止历史订单权益被后台“变质”。

- 客户端安全与数据：支付链接只允许 HTTPS/支付宝协议并在系统浏览器边界二次校验；sing-box 核心更新必须匹配官方 SHA256 清单；字段类型错误的本地 JSON 配置会回退 `.bak`，不再部分解码后覆盖用户数据。

- 代理可信链：Fastify 只信任一个反向代理 hop，Nginx 强制覆盖 `X-Forwarded-For` 为 `$remote_addr`；生产配置已 reload，两个 API location 均生效。



## 生产核验

- 生产库当前已付订单 2 笔、失败或过期订单 4 笔；同一用户同等级的有效权益重复组数为 0；最新发布记录为 1.9.20。

- 自动对账已把历史失败订单重新查询为真实的 expired/cancelled，未触碰两笔已付订单，API 日志无 error、fatal 或 uncaught。

- 本次服务器直接重建镜像时 npm registry 元数据查询连续两次超时；已按既有锁文件与旧镜像依赖做无网络 overlay 镜像，仅覆盖本提交源码，并先在 18781 临时实例验证健康与真实数据库对账，再切换生产。Windows `git archive` 解包出的 `api-entrypoint.sh` 需要在 Linux 侧先去除 CRLF。



## 稳定架构事实

- 商业权益真源在服务端 PostgreSQL；授权租约为 Ed25519 签名，绑定账号、设备、硬件指纹、套餐和到期时间。

- 支付通道为统一收款 5ff 的中转适配器，生产密钥仅保存在深圳机 `/opt/proxysplit/secrets/payment-zhongzhuan.env`，仓库不保存密钥。

- 生产站点：`https://proxysplit.zygskins.cn`；SSH 别名 `proxysplit-shenzhen`；管理员凭据只在 `C:/Users/Administrator/.config/proxysplit/shenzhen-admin.txt`。

- 正式客户端构建：`.\scripts\build-commercial.ps1 -Version <版本>`；发布私钥为 Git 忽略文件 `server/secrets/shenzhen-release-private.pem`。



## 后续待办 / 已知设计风险

- 支付退款或撤销尚未设计自动回收策略；现有订单模型会把多次购买累计到同一权益，不能简单按单笔退款倒扣，需单独设计权益流水账后再实现。

- 免费试用硬件标识仍依赖客户端上报摘要；离线宽限仍无法完全抵御系统时间回拨或整机快照恢复。这两项属于架构级风控，不是本轮付款到账故障。

- 支付提供方后续可给 ProxySplit 单独创建 AppID 并映射到同一商户；客户端仍待补 Windows Authenticode 证书。

## 2026-07-24 v1.9.26 ?????????
- ????????????? 30 ? VMess/WS ????? 3 ???????/????/?????????v1.9.26 ??????????????? 27 ??
- ???????? TCP ????????? WebSocket Upgrade ?? 5 ????????sing-box ?????? `dial tcp ... i/o timeout`?????????????????????????? ProxySplit ?????
- ??????????????????? TCP ?????? WS/TLS ?????????????????????? latency/subs ??????? `go test ./...` ? `go vet ./...` ???
- v1.9.26 ????EXE 81,152,000 ???SHA256 `cbbf297b391451713f88c49e8e2e126d867c417aa82684c2ff4167c17493e46b`??? API??????????????? 1.9.26??????? `/opt/proxysplit/releases/20260724-170300-5e83a1b`?
- ???? v1.9.27?Reality ???? TLS?????????? TLS/WS ?????Reality ?? TCP ??????? Reality ??????EXE 81,078,272 ???SHA256 `50723eea3a97728c9690b81580aa8db0e1a28b048677d33cd1c564a27653b72e`??????? `/opt/proxysplit/releases/20260724-171000-aae8de3`???/API/??/???? 1.9.27?

## 2026-07-24 v1.9.28 Clash ????
- ????? User-Agent ?????ProxySplit/v2rayN ?? 30 ? base64 VMess?3 ?????27 ???????Clash/FLClash ?? Clash YAML??? 30 ? VMess + 4 ?? Clash ??? Hysteria2?????? Clash YAML????????? HY2 ???
- ??? Clash/Mihomo YAML ??? Clash.Meta User-Agent??? VMess/VLESS/Trojan/SS/SOCKS/HTTP/Hysteria2/TUIC/AnyTLS????????????????????? ID???????????
- ?? Mihomo v1.19.28 ?? VMess ???? 5 ???????? VMess ???????????? HY2 ? sing-box ????? v1.9.28 ???????????? HTTP 204?????????? 0.37 ??
- v1.9.28 ???????EXE 81,305,600 ???SHA256 `9d0335ab65261d4cb7c7bb4bf590e2a3258e6e994bd3f501f42fd960753d7bf3`???/API/????????? `/opt/proxysplit/releases/20260724-173000-0a0bc12`????????? 31 ???????? 4 ? HY2?

## 2026-07-24 v1.9.29 ????????
- ??????????`d817abd` ????????/????/????`9da5352` ?????????`5d212d6` ?????????????
- ??????? `0007_admin_grants_redeem.sql`?API ???? overlay ??????? healthy?????? JS ?????????????????????? 200???????? `/opt/proxysplit/releases/20260724-175000-e068c5f`?
- v1.9.29 ??????????????????EXE 80,997,888 ???SHA256 `56c0559cfef98a81315b9d09fb0ffb55ac0a37a066a51a9edf1a7cffcbfb9189`?ProductVersion/FileVersion?????? API???????????
- ???Go ????/vet?Svelte check/build???? typecheck?core 18 + API 3 ???admin/API build ?????? health???????????????????????
