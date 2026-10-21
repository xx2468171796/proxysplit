# AI 强制走线路 + AI 访问锁 + AI 环境检测

2026-10-21 起（v1.9.71）。只对 **AI 编程官网（中转站渠道，`channel = aigw`）的客户** 开启，其他用户行为不变。

## 为什么
中转站客户用 Claude / ChatGPT 等账号敏感的 AI 服务，出口一旦是客户本机的国内 IP（ProxySplit 没开、程序没列进名单、
选了「直连」），账号就可能被风控封掉。以前 AI 只有在「程序被列进应用分流 + 代理开着」时才走我们的线路。

## 做了什么
1. **AI 强制走线路**（`internal/core/aiguard.go`、`internal/service/aiguard.go`）：内核规则里 AI 服务的域名 / 地址
   排在所有应用名单和代理策略前面（只在「拦截」的程序之后），不管哪个程序发起、规则 / 全局 / 直连哪种模式，一律走 POWER云 线路：
   - 线路选择：活动节点是 POWER云 节点就用它，否则用列表里第一个 POWER云 节点；**一个都没有 → 拦掉**（绝不直连）。
   - AI 的 QUIC（UDP 443）拒绝，浏览器退回 TCP（域名一定能嗅探到）。
   - AI 域名经这条线路解析、**只要 IPv4**：AAAA 和 HTTPS 记录（带 ipv6hint）直接回空。隧道没有 IPv6 地址，给了 IPv6
     程序就会绕开隧道用本机 IPv6 直连。不用 DNS 规则的 `strategy`（sing-box 1.14 起弃用，1.16 删除）。
   - POWER云「仅 AI」/ 拦截名单的改写（`restrictEgress`）不碰这几条规则：AI 宁可被节点拒，也不能被改成直连。
   - Claude Code 加速入口（accel-in）也走这条线路。
2. **AI 访问锁**（`internal/aiguard/nrpt_windows.go`）：Windows 自带的 NRPT（按域名指定 DNS 服务器的系统策略）把 AI 域名
   的解析固定到本机回环地址 **`127.0.0.53`**，内核开 AI 锁时在这里监听 53 端口应答。ProxySplit 开着 → 正常解析走线路；
   停了 / 退了 / 被杀 / 没开机自启 → 本机没人应答、立即失败，**AI 网站直接打不开**，查询出不了这台电脑。
   - 为什么必须是回环地址：最初用 TUN 对端 172.19.0.2，2026-10-21 实测内核停掉后查询照样发出电脑、被办公室路由器的 DNS 劫持
     代答（返回 198.18.x 假 IP）——会劫持 53 端口的路由器 / 运营商都会这样，锁就漏了。回环地址的查询永远出不去。
   - 53 端口被别的程序占了（多半是别的代理软件）：内核照样启动、只是不开监听，AI 解析不了（仍然锁住），环境检测会说明。
   - 每次内核启动后清一次 Windows DNS 缓存，免得停机期间缓存的失败结果残留。
   - Chrome / Edge 检测到 NRPT 规则会自动关掉自己的「安全 DNS」，所以浏览器也受锁。规则带注释 `ProxySplit-AI`，只增删自己那条。
3. **打开即保护**（`aiguard_app.go`）：程序启动（含开机自启、AI 官网免登录下载）后自动启动代理；第一次自动启动时顺带开开机自启。
   - **开机自启改成计划任务**（`internal/autostart`，所有用户）：程序清单要求管理员（TUN），Windows 开机时会静默跳过 HKCU Run
     里要提权的程序，以前的「开机自启」其实从没启动过。现在是登录触发、最高权限、托盘启动（`--background`）、用电池也启动、不限运行时长的计划任务；
     老版本写的 Run 值启动时自动迁移。
4. **AI 环境检测**（`internal/service/aienv.go`，概览页卡片，仅中转站客户可见）：AI 只走我们的线路、AI 出口地区（经 AI 主机的
   Cloudflare trace 实测，必须台湾；大陆 / 港澳 / 受制裁地区判高风险）、AI 域名解析（只返回 IPv4）、IPv6、系统时区（应为台北时间，
   与北京同为 UTC+8，改了钟点不变）、系统时间偏差、其他代理 / VPN（进程、虚拟网卡、代理环境变量、别人设的系统代理）、开机自启。
   可修的项：立即保护（加锁 + 启动代理）、改台北时区、立即对时、开机自启；「一键修复」全部执行。

## 什么时候加锁 / 撤锁
- 加：中转站客户已登录（开发版无授权，只看渠道）。启动时、登录后、每分钟看门狗都会核对（被人删了会补回；写失败 10 分钟后重试）。
- 撤：退出 ProxySplit 登录。
- 程序被删了还锁着（AI 网站全打不开）：运行任一版本 `proxysplit.exe --unlock-ai` 解除，或管理员 PowerShell
  `Get-DnsClientNrptRule | ? Comment -eq 'ProxySplit-AI' | Remove-DnsClientNrptRule -Force`。
- 域组策略下发了 NRPT 时本地规则不生效（公司电脑），环境检测会提示。

## AI 名单
`internal/aiguard/ai.json` = 公司规则包 `ai` 类别原样拷贝（powervpn 仓 `packages/core/data/rulepack/ai.json`，
版本记在 `aiguard.RulepackVersion`）。规则包升版后重新拷贝并改版本号，不在这里手改。

## 验证
- 真内核路由矩阵：`internal/core/aiguard_test.go`（各应用位置 × 三种代理策略都走 AI 线路；仅 AI 名单漏了的 AI 域名不会被改成直连；没有线路 = 拦截）。
- 锁的机制（2026-10-21 业主办公电脑，用测试域名、不碰 AI 域名）：NRPT → 127.0.0.53 → sing-box 1.14.3 应答，只回 IPv4；停内核后立即「No such host」。
- 计划任务：`internal/autostart/autostart_test.go` 用真实任务计划程序注册再删除，核对最高权限 / 托盘启动 / 电池 / 时长。
- 远程实测机 alonehome2：开着时 AI 走台湾、关掉后 AI 解析失败、退出登录后恢复（记录见 `.ankotti/MEMORY.md`）。
