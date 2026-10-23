# AI 劫持模式

> 设计 docs/AI强制走线路.md；名单 internal/aiguard/list.go。版本事实见 docs/decisions.md（v1.9.71 / v1.9.72）。

## 范围与原则
设置页「AI 劫持」分区对所有用户开放（2026-10-23），概览卡片仍只给 aigw 客户；没有 POWER云 线路时 AI 走当前选中节点，仍不直连，只有没节点才拦。
劫持只管 Claude（Claude Code CLI / 客户端 / 网页）和 OpenAI（ChatGPT / Codex），名单写在 internal/aiguard/list.go，不再整份照搬规则包（业主 2026-10-21 定）。
- 对象是中转站客户：AI 一律走 POWER云 线路，没线路就拦。
- 概览页有 AI 环境检测，分别测 Claude 与 OpenAI 两家出口，并提供一键修复。

## 锁机制
NRPT 把 AI 域名解析锁到回环地址 127.0.0.53（内核监听），软件关了 AI 就打不开。
- 必须用回环地址：锁最初指向 TUN 对端 172.19.0.2，内核停后被办公室路由器 DNS 劫持代答（198.18.x）。
- sing-box 1.14 DNS 规则 `strategy` 已弃用（1.16 删）；只要 IPv4 改用 query_type AAAA/HTTPS → predefined NOERROR。
- 开机自启改计划任务（Run 键对 requireAdministrator 程序开机不生效）。

## 解除方式（红线）
只有界面「恢复」能解除锁；退出登录、删数据目录都不解，且不提供命令行 / 远程解锁。

## 待验证
alonehome2 一上线就用正式版做端到端实测（开着 AI 走台湾、关掉 AI 打不开、恢复后正常）；1.9.71 发布时只在业主办公电脑用测试域名验证过锁机制，alonehome2 与 tw-win11 当时都离线。
