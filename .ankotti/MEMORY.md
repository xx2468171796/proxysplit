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

## 2026-07-24 v1.9.30 节点测速
- 修复非活动节点仅探测远端端口、无法真实验证 VMess/Reality/Hysteria2 等协议的问题：每个节点使用隔离的临时 sing-box 完成全协议、鉴权和出站链路测试；全部测速使用 4 个并发 worker。
- 节点下载测速不再要求主代理已经启动；主核心不可复用或处于 TUN 模式时自动使用临时测试核心。应用规则的“测试”也复用同一真实节点探测链路。
- 顶部活动节点、应用节点选择器和自定义线路选择器统一显示“延迟 / 未测速 / 不可用”；节点列表增加单节点“测延迟”，全部测速期间显示明确进度状态。
- 实机完整协议验证：DMIT-HiNet-Fixed(VLESS) 295 ms、日本JP-HY2(Hysteria2) 562 ms；Go test/vet、Svelte check/build 全部通过。
- 正式客户端 `output/proxysplit-v1.9.30.exe`，81,723,392 字节，SHA256 `db05f4b991e6e1d63b59c5c6e176f0a1cdfa3ee74985978f696facb8557b590f`；本机已启动 ProductVersion/FileVersion 1.9.30。
- 生产发布 API、下载和官网均已切换 v1.9.30；站点版本目录 `/opt/proxysplit/releases/20260724-184000-bd11c3f`。
- 用户点名复测“日本-优化3”：ProxySplit/sing-box 真实 HTTPS 出站失败，远端 `t.cnmjcn.cyou` 解析到 `162.19.192.89:16617` 后超时/强制断开；使用官方 Mihomo v1.19.28 直接加载机场 Clash 配置同样失败，排除 ProxySplit 解析和 Clash 兼容问题。该订阅的“日本-优化”“日本-优化2”“日本-优化3”均失败，`日本JP-HY2` 实测 HTTP 204 成功。

## 2026-07-24 v1.9.31 陈旧节点引用修复
- 修复应用规则保存时报“引用了不存在的节点”：启动时自动把已删除的应用节点覆盖回退为活动节点，自定义线路缺失节点也自动跟随活动节点；不再因一条旧规则阻断整页保存。
- 订阅刷新在端点完全相同时保留 ID/测速，在提供方更换地址但“协议+节点名”唯一相同时保留逻辑节点 ID 并清空旧测速；删除节点或订阅后同步修复所有引用并实时重载。
- 当前真实配置验证：msedge/msedgewebview2/esbuild/chrome 四条规则的陈旧节点 ID 均已清理，引用完整性全部有效。
- 正式客户端 `output/proxysplit-v1.9.31.exe`，82,661,888 字节，SHA256 `500210bb70862fd9dcad6d49636c7702374f3320d597fa9bb432b49185776299`；生产 API、官网、下载与本机进程均已切换 v1.9.31，站点目录 `/opt/proxysplit/releases/20260724-190500-1e02f0d`。

## 2026-07-24 v1.9.32 订阅编辑与真实连通性
- 订阅卡片新增“编辑”，可修改名称和 URL；保存前先拉取并解析新地址，失败时不改旧订阅、不删旧节点，成功后保持订阅 ID 并原子替换节点。
- 节点“延迟”测试改为完整协议隧道内访问 `https://www.google.com/generate_204`，必须完成 DNS、代理握手、TLS 并返回 HTTP 204 才显示毫秒数；TCP 能连但 Google 不通会明确显示“Google 不通”。
- 配置加入连通性探测版本，首次升级自动清除旧版 TCP 延迟缓存，避免历史假阳性继续展示；新导入节点显示“未检测”而不是误报不可用。
- 本机当前 39 个节点按新标准实测 Google HTTPS 为 0/39，证实截图中的 4/5 ms 是旧 TCP 假阳性，不能代表节点可上网。
- 回归通过：`go test ./...`、`go vet ./...`、Svelte check/build；正式产物 `output/proxysplit-v1.9.32.exe`，81,974,272 字节，SHA256 `e500cdcd015a830be50d6c0f26b4bbf6691cb9c20da8e9dfe6afe1e0c8622187`。
- 生产 API、官网、下载与本机进程均已切换 v1.9.32；生产站点目录 `/opt/proxysplit/releases/20260724-193000-d5b4cfc`。
## 2026-07-24 v1.9.33 实时上下行速度修复
- 根因确认：迁移到 sing-box 原生分流后，`Status.Stats` 仍沿用已删除的 WinDivert 计数器，服务端始终返回 0；前端虽然每秒计算差值，但数据源从未变化。
- 已改为每秒读取 sing-box Clash API `/connections` 的 `downloadTotal`、`uploadTotal` 和活动连接数，前端按相邻累计值计算实时 B/s、KB/s、MB/s。
- 修复 1480px 响应式规则按 DOM 序号误隐藏“上传”的问题；窄窗口现在优先保留下载、上传和启动按钮。
- 实机启动 v1.9.33 后验证 Clash API：2 秒内下载累计增加 14,095 字节、上传累计增加 11,327 字节，活动连接 8，数据源会真实变化。
- 回归通过 `go test ./...`、`go vet ./...`、Svelte check/build；正式产物 81,877,504 字节，SHA256 `efa2b812a1be04be17bf35005b8b7b2322bdb70c6d90c260968e7b507c44d175`。
- 生产 API、官网、下载与本机进程均已切换 v1.9.33；生产站点目录 `/opt/proxysplit/releases/20260724-194300-8dd86d3`。

## 2026-07-24 v1.9.34 节点表格列对齐
- 根因：表头和每条数据行分别使用独立 CSS Grid，末列 `auto` 会按各自行内容计算宽度；表头“操作”较窄、数据行按钮较宽，导致前面的“Google 连通 / 速度”等列整体错位。
- 修复：节点表格由父容器统一定义四列轨道，表头与数据行改用 `subgrid` 共享同一组列宽及间距；同时统一表头和数据行的水平内边距，标题与内容严格对齐。
- 验证：Svelte check 0 errors/0 warnings，前端生产构建通过；本机已启动 v1.9.34 并完成界面截图检查。
- 正式产物：`output/proxysplit-v1.9.34.exe`，82,286,592 字节，SHA256 `5d82f548244aec00d2513e5f2ee5b19b5a08e3516d1e1fcee55e4059bc779b0b`。
- 生产 API、官网与下载均已切换 v1.9.34，站点目录 `/opt/proxysplit/releases/20260724-200000-feae2ac`；线上 latest=1.9.34，安装包 HTTP 200 且长度匹配。

## 2026-07-24 v1.9.35 TCP 延迟 / Google 延迟拆分显示
- 需求：节点延迟同时显示 TCP 延迟与 Google 延迟并做区分。latency.Measure 改为双指标 Result{Latency, TCPLatency}：measureTCP() 恒定直连 dial 到节点边缘（含 tls/reality/ws 握手）=TCP 延迟；有 SOCKS 隧道时额外经隧道测 Google HTTPS 204=Google 延迟。nodes.Node 加 tcpLatency 字段；service/前端两张节点表各加一列（表头 TCP 延迟 / Google 延迟 + 悬浮说明，不通分别标注 TCP 不通 / Google 不通）；health.go 无隧道探测改读 .TCPLatency，apptest 走真隧道仍读 .Latency。
- 🔴 发布流水线两个潜伏 bug（本机 core.autocrlf=true 触发）：①`git archive HEAD:server` 只读 server 子树的 .gitattributes，根目录 eol=lf 不生效 → api-entrypoint.sh 被写成 CRLF → 容器 `exec /app/deploy/api-entrypoint.sh: no such file or directory`。修复：新增 server/.gitattributes（子树自带 *.sh eol=lf）+ release-all.ps1 git archive 加 -c core.autocrlf=false。②release-all.ps1 Run 函数在 $ErrorActionPreference=Stop 下把 pnpm/go 的 stderr 横幅当成终止错误 → 改为仅按 $LASTEXITCODE 判定。③首次失败留下的 proxysplit-v1.9.35.exe 进程锁文件导致 Copy-Item 失败 → 需先杀占用进程。
- 回归：go test/vet、svelte-check、pnpm typecheck/test/build 全过。正式产物 output/proxysplit-v1.9.35.exe，78.6MB，SHA256 3fc1ab71338282ee1bd78a870770b20e6fc3474b10b0721e6b410392639a9470。
- 生产 API、官网、下载均已切换 v1.9.35；latest API=1.9.35，health ok，proxysplit-v1.9.35.exe 与 proxysplit-latest.exe 均 HTTP 200/78.6MB。站点目录 /opt/proxysplit/releases/20260724-203840-dec2549-v1.9.35，DB 备份 postgres-20260724-203840-dec2549-v1.9.35.sql.gz，commit dec254963309d9d982bc575f84dd51af01d7fa82。

## 2026-07-24 v1.9.37 修复运营后台"数据全空"(设备名额锁死)
- 事故：用户报后台用户/套餐全空、疑似数据丢失。真相：数据完好(库内 users=3/plans=12/orders=6/devices=12/licenses=4)。根因是 admin 账号既做后台登录又做发布自动化，历次发布用不同指纹登录把设备槽(默认 default_device_limit=3)占满(积累 10 个活跃设备)；用户后台会话重新认证时 bindDevice 撞上限 → 返回 pending token → 所有 /v1/admin/* 报 DEVICE_ACTIVATION_REQUIRED → admin 前端 catch 成空数组 → 看似数据丢失。
- 应急：SQL 把 admin 名下 8 个一次性发布/测试设备 revoked=true + 撤销其会话，保留浏览器设备(运营后台 1e36fc5b)+发布器(317f69d9)，降到 2/3。实测 admin API 立即恢复(users=3/plans=12/dashboard 正常)。
- 持久修复(v1.9.37)：① auth.ts login+activateDevice：admin 角色设备上限设为 Number.MAX_SAFE_INTEGER(免限)，普通账号不变。② admin/api.ts：login 遇 deviceLimitReached/无 token 抛错显示在登录页不再静默存 pending；api() 对 401/ACCESS_INVALID/DEVICE_ACTIVATION_REQUIRED 清 token+reload 回登录页。生产验证：全新指纹登录 admin 直接拿真实 deviceId、无 limit。
- 教训：① bindDevice 按 revoked=false 计数、复用同 fingerprint_hash 设备；② 发布自动化复用 admin 账号会吃设备槽——新 release-all.ps1 已用固定指纹(codexreleasepublisher...)只占 1 槽；③ 前端列表 catch 成空会把"鉴权失败"伪装成"数据丢失"，务必区分。

## 2026-07-24 v1.9.38 运营后台 shadcn 重写 + 兑换码多人复用 + 下载统计
- 后台全量重写 shadcn-admin（多智能体 workflow，13 agent）：所有 /v1/admin 列表接口加分页(limit/offset)+搜索(q)+筛选+排序(白名单防注入)，统一 {items,total,limit,offset}；orders 附 amountSum；新增 GET /v1/admin/analytics(9组按天聚合,Asia/Shanghai)；补全 DELETE users(拦截删自己/最后admin)/plans(引用409)/redeem(已用409)/releases。前端 Tailwind+shadcn/ui+react-router+@tanstack/react-table+recharts，通用 DataTable + 11 模块页 + 仪表盘(6 KPI+9 图表+7/30/90天)。
- 并发会话同时开发的功能一并合入(本会话独立复验后提交 158bda0)：兑换码一码多人复用(redeem_codes.max_uses/used_count + redeem_redemptions 表 UNIQUE(code_id,user_id)，迁移 0008)+ 修复重复兑换翻倍(client.go：兑换POST成功后 refresh/lease 失败不算失败)+ 下载/浏览量统计(/v1/download/:file 302前埋点 + /v1/track/view + 后台 downloads.tsx)。
- 🔴 部署踩坑：admin 新增依赖(radix/recharts/react-table)使 docker pnpm-install 缓存失效，服务器(深圳)直连 npmjs.org 拉包 403s 超时致部署失败两次。修复：Dockerfile 加 `pnpm config set registry https://registry.npmmirror.com` + fetch-timeout 600s + fetch-retries 5(npmmirror 是 npm 完整镜像，integrity 一致不影响 --frozen-lockfile)。以后依赖变更不再卡。
- 教训：多会话/多agent 同仓库并发编辑会让发布预检(要求工作区干净)失败——先确认对方开发完成，独立复验合并树(typecheck/test/build 全绿)后统一提交，避免 stash 破坏对方进度。
- 生产验证：latest=1.9.38，health ok；实测 users分页/orders筛选+amountSum(3180)/analytics/audit分页/redeem maxUses·usedCount/download 302/delete 404 全部正常。commit 158bda0，SHA256 570a9f65586c3d1408bfba06051ac10a600d15105dbe4580cdb250ea0c71729c，站点 /opt/proxysplit/releases/20260724-222507-158bda0-v1.9.38。

## 2026-07-24 v1.9.39 运营后台 UI 统一打磨 + 兑换/下载加固
- UI 打磨(多智能体 workflow，13 agent，11 页并行)：统一页头(app-shell 单一数据源)、DataTable 用法、状态徽章 label+variant 配色(启用绿/待黄/失败红/停用灰)、按钮规范(工具栏 icon+文案/行操作 dropdown/破坏性二次确认)、空/加载/错误态、dashboard+downloads 共用图表范式。功能全保留(搜索/筛选/分页/CRUD)。兑换码弹窗保留"发放方式"分组+预设(一人一码/一码多人)+实时说明。
- 并发会话兑换/下载收尾加固一并合入：下载接口 releaseExists 拒伪造版本(防污染统计)、track/view 限流收紧；deleteRedeemCode 对 used_count>0 的多人码拦截删除(防 CASCADE 抹兑换台账)。
- 🔴 迁移隐患修复：migrate.ts 按文件名(schema_migrations.name)记录、已应用即跳过、不校验内容 hash。并发会话把新索引加进已部署的 0008 → 现有生产库不会重跑该索引。改用独立 0009_download_events_time_idx.sql(IF NOT EXISTS 幂等)让索引正确落库。教训：改已部署迁移无效(按名跳过)，schema 变更必须新迁移文件。
- 生产验证：latest=1.9.39，0009 applied，admin/site 200；回归 users分页/orders amountSum(3180)/analytics/downloads(200)/下载伪造版本404/真实302 全过。commit e31e289，SHA256 ed2dc69e199d904a994c4547f25857868e86f169a356be44034b50f9fc05d1b0，站点 /opt/proxysplit/releases/20260724-225941-e31e289-v1.9.39。

## 2026-07-24 v1.9.40 运行诊断——实时连接命中规则+出口
- 论坛反馈：诊断页直接显示"这条连接命中哪条规则、走哪个出口"比看日志强。数据现成在 sing-box clash_api /connections（之前 clashTraffic 只数条数、丢弃 metadata/rule/chains）。
- clash.go 新增 clashConnections 解析每条连接(metadata 进程/目标、rule+rulePayload 命中规则、chains 出口链)；Service.Connections 把出口 tag 映射友好名(proxy=活动节点/node-<id>=对应节点/direct=直连/reject=拦截)；app.go GetConnections 绑定。App.svelte「日志」页升级「运行诊断」，顶部实时连接表(进程→目标→命中规则→出口，出口三色，可过滤，每秒刷新)。go build+svelte-check 过。生产 latest=1.9.40，commit 76627af。
- 注：客户端功能无法无头实拍(需管理员+真实 TUN 流量)，走标准 clash_api 格式+字段缺失兜底。

## 参考：ProxyBridge (github.com/InterceptSuite/ProxyBridge) 对照
- 同赛道竞品(Proxifier 替代品/按进程分流)，但技术栈无关：原生 C + WinDivert(Win)/NetworkExtension(mac)/NFQUEUE(Linux)，上游仅 SOCKS5/HTTP。跨平台但一平台一套原生实现。
- 我们优势：现代协议(reality/hysteria2/vless/vmess/trojan/tuic)、产品完整度(订阅/测速/TUN/系统代理/LAN/AI控制/商业后台/运行诊断)。方向领先，不用改路线。
- 唯一可借鉴点：它每条规则可按 进程+IP+端口+协议+主机名(通配)组合匹配 allow/block；我们应用规则主要按进程名。sing-box 路由底层已支持 domain/ip/port，可把应用规则升级为"进程 + 目标(域名/IP/端口)"条件，让分流更精细（待用户确认是否做）。[[proxysplit-project]]

## 2026-07-24 v1.9.41 应用规则目标条件(进程+域名/IP/端口精细分流) + 拆单支付 + 渠道隔离
- 借鉴 ProxyBridge：应用规则可选带 domains/ips/ports 目标条件=作用域规则(该应用只有去这些目标的流量按规则走，其余走默认；全空=整个应用，向后兼容)。core.ScopedRule + config.go scopedRuleEntries(域名/IP 分开成规则、端口收窄、尊重顶栏直连急停)，置于广义 process_name 组前；service.Start 把 r.Scoped() 的规则分流为 SplitScoped(direct/reject/节点tag)；App.svelte 应用规则行可展开"目标条件"编辑器+限定徽章。TestSplitScopedConfig 过 sing-box check(域名+端口/IP段/拦截/端口段四类)。
- 并发会话(已确认做完，本会话核对合并树后合入)：①支付拆单(价超网关单笔上限拆多子订单顺序扫码，迁移 0008_split_orders 加 orders.group_id/split_index/split_total，client.CreateOrder 返回 Checkout)②发布渠道隔离(/v1/releases/latest?channel 过滤 + string_to_array 版本数字排序，修 1.9.40<1.9.9 字典序)。
- 🔴 教训：并发会话改了 CreateOrder 返回类型(Order→Checkout)但漏改 internal/license/retry_test.go，我核对时只跑了 core/service/latency 没跑完整 go test ./... 漏过，预检才炸。**核对合并树必须跑完整 `go test ./...`**。已修 retry_test(mock 返 Checkout、断言 order.Order.OrderNo)。
- 生产 latest=1.9.41，migration 0008_split_orders applied，channel 隔离生效(beta=null)。commit f8904ef，SHA256 fd7b490148964be6ec8d88ef99d9c1cef16ca1c7d1b072bc901effa6782878e1。注意 migrations 有两个 0008 前缀(multiuse + split_orders)，按名各自记录、幂等、无碍。
