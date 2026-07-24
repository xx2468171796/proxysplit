# ProxySplit 项目状态

## 当前发布
- 2026-07-24：第三轮“支付 / 认证 / 客户端”多智能体对抗审计已完成，修复版本为 `v1.9.20`，源码提交 `322c4f4bff26ca54ff0b3d1e251023f86f0ef506`。
- 服务端当前部署：`/opt/proxysplit/releases/20260724-124715-322c4f4`；API、PostgreSQL、Redis 均 healthy，公网 `/health`、套餐目录、后台和官网正常。
- 客户端产物：`output/proxysplit-v1.9.20.exe`，大小 `80,241,664` 字节，SHA256 `974c356460a959d7aa9f814647c9a1ac074578a2c51a011cd53e5a39217a3528`；正式下载和 `/v1/releases/latest` 已切至 1.9.20，线上下载哈希一致。
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
