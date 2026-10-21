# Claude 加速 / 兜底握手

> 设计 docs/Claude加速-网关切换.md；代码 internal/accel、accel_app.go、internal/accel/tlsprofile.go。版本事实见 docs/decisions.md（v1.9.57 / v1.9.73 / v1.9.74）。

## 工作原理
线路落地是 POWER云 节点（中继签名验过）时，客户端自动把 Claude Code 切到「编码模式」，否则保持官方默认。
- 切换方式：改 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL 指向本机 127.0.0.1:18765，逐字节可还原；设置页有卡片。
- 编码端经 sing-box 本机入口 accel-in 走 Claude Code 所在线路，连 accel.powervpn.internal:8896（落地机改写到本机中继，sub2api 仓 accel/ 0.5+）。
- 服务端 `POST /v1/accel/token` 签 24 小时加速令牌，私钥在 sz `/opt/proxysplit/secrets/accel-token-private.pem`（挂进容器 → ACCEL_TOKEN_PRIVATE_KEY_PEM；资产「ProxySplit · Claude 加速令牌签发私钥」），与会员租约密钥分开。

## 兜底握手必须跟着中继走
兜底握手不能写死：中继 accel 0.6.3 打招呼时交来整份稳定握手配置（指纹 hs 经 v2 签名），客户端按 BoringSSL 复刻。
- 原先写死的握手从没与官方对齐过（多 GREASE ECH / padding、缺 X25519MLKEM768、10-17 起又缺 ed25519 / ECDSA+SHA512）。
- 复刻不了 → 不接管 Claude Code、旧会话回 503 不直连。
- 验证方法：direct_test 与官方 2.1.306 实抓逐字节比对；tls.peet.ws 实测 JA4 t13d1713h1_5b57614c22b0_7f527383e249 与官方一致；tw-pro 现网打招呼验签 + 复刻通过。

## 握手复刻不了时的暂停行为
暂停加速时已指向编码端的会话要继续走中继（1.9.74 修；1.9.73 一直回 503），暂停期间每 60 秒才复查（以前每 3 秒打招呼）。
- sub2api 哨兵特性 `proxysplit-accel-fallback` 盯 cc-follow 的配置本仓复刻不复刻得了；词表抄自 tlsprofile.go，两边必须同改。
- 官方要改代码的握手变化 → 同步本仓：sub2api docs/cc-follow.md §6 第 8 步。

## 发布提醒
`git archive HEAD:子目录` 在 Windows 上会输出 CRLF，打包要加 `-c core.autocrlf=false`（见 release-process.md）。
