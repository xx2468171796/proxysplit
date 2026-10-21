# 已知限制 / 待办 / 风险

## Windows 代码签名与杀软误报
Windows Authenticode 证书尚无，Ed25519 更新签名不能替代代码签名；取得真实发布者的受信任证书后，通过 build-commercial.ps1 的 SigningThumbprint / SignToolPath 参数签名。
- 2026-09-17 用户报告安全中心删文件，至今没提供受影响机器 / 版本 / 威胁名 / 路径；开发机无可用 Defender，引擎缺失不等于扫描通过，不能宣称已排除病毒或消除误报。
- 证据采集 scripts/diagnose-defender.ps1（已修：隔离后不存在路径不再直接退出，增加检测历史 / 威胁名 / 事件日志采集）；签名与微软申诉流程 docs/windows-security.md。
- 红线：不得通过禁用 Defender、加排除项处理；运行时替换 PowerShell 的试改已撤回，没有证据不发版。
- 待办：拿到实际威胁名 / 路径，在带有效 Defender 的 Windows 实测新版；确认误报后走微软软件开发者申诉。
- 2026-10-16 起另有「安全软件拦 sing-box.exe」识别（火绒等），见 testing-machines.md。

## 权益与授权
退款 / 撤销权益回收：2026-09-26 起有权益流水 license_grants 和整组退款，之前的订单无流水只标退款，需手动调；不能按单笔退款直接倒扣共享权益。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨 / 快照风险（已加 lease iat + LastSeenAt 高水位，容差 10 分钟）。

## 网络
- 系统 DNS 为公网地址时，开代理后查不存在的域名约等 12 秒（strict_route），见 ai-control.md。
- 台湾节点 → 深圳站点约 1/3 TLS 失败（深圳链路 / WAF）；自家国内站点设直连。

## 待办
- AI 劫持端到端实测（alonehome2 上线后），见 ai-guard.md。
- FakeIP（白名单下没列出的程序查境外域名不再经节点）：用户决定等有能开 TUN 的测试机实测后单独发。
- POWER云 节点 + 访问范围在真实墙内网络的实测（用 alonehome2）。
- 把 release-all.ps1 的上传 / 远程执行改走堡垒机（2026-09-29 待办；2026-09-28 起 remote-deploy.sh 已修，但直连 ssh 部分仍违规）。
- 堡垒机「翻墙」能力（按人授权、节点分类下发、延迟自检）。

## 迁移原文条目（来自旧 MEMORY.md，供核对）
- Windows Authenticode 证书尚无；Ed25519 更新签名不能替代代码签名。
- 2026-09-17 本机构建环境没有可用 Defender 命令/CIM/扫描程序，旧版签名实测 NotSigned；尚未得到实际告警名称，不能宣称已排除病毒或消除误报。
- 误报证据采集：scripts/diagnose-defender.ps1；签名与微软申诉流程：docs/windows-security.md。不得通过禁用 Defender、加排除项处理。
- 获取实际 Defender 威胁名称/路径，并在带有效 Defender 的 Windows 实测新版；确认为误报后走微软软件开发者申诉。
- 取得真实发布者的受信任代码签名证书后，通过 build-commercial.ps1 的 SigningThumbprint/SignToolPath 参数签名。
- 退款/撤销权益回收尚无独立权益流水账设计；不能按单笔退款直接倒扣共享权益。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨/快照风险。
