# 测试机 / 远程测试 / 本机实测

> 逐次测试结论见 docs/decisions.md（v1.9.67 / v1.9.69 / v1.9.70 / v1.9.71）。

## alonehome2（阿龙家里电脑2）是远程测试主力
真实墙内网络，正式版装在 %LOCALAPPDATA%\ProxySplit\proxysplit.exe（--background 启动）；经堡垒机 run_command 调 `C:\ProgramData\ps-diagrun\psapi.ps1 GET|POST <路径> [body]`（token 自读）。
- 测试账号 pv_442924c8（POWER云 power1010250），10-16 后台发普通会员 7 天到 10-23（过期需重发）。
- 已测：只代理列出的 / 默认全代理 / 整机全局三种模式 × 百度 / QQ / Google / YouTube 全部符合预期，自定义规则 4 类生效（用业主原配置 + twpro 节点，自检 20/20）。
- 未测：POWER云 节点 + 访问范围；AI 劫持端到端（见 ai-guard.md）。
- 它和 tw-win11 有时离线，发版前先确认在线。

## 火绒：模拟「安全软件拦 sing-box」
alonehome2 装火绒 6.0.12.2；默认不拦，在「访问控制 → IP协议控制」加规则阻止 sing-box.exe 才能复现「开代理百度打不开」。
- 装了火绒后 Windows 防火墙规则不生效（火绒接管），模拟拦截必须用火绒 IP协议控制。
- 远程关 IP协议控制会弹 UAC 安全桌面，远控点不了，要现场或换办法。

## 办公室本机的局限
办公室这台走 3 层路由，DNS 是内网 192.168.10.1，测不出 DNS 问题；主路由也无法单独排除这台。

## 下载 / 验收用机
tw-bbr3、tw-pro（台湾）用于现网互通和 internal/updater 验收；tw-bbr3 ↔ 深圳大文件下载会中途截断，验收下载用国内机（飞牛）或重下。
- tw-pro 现网互通测试：Claude 加速打招呼验签 + 复刻、兜底直连真官方 401。

## 本机跑正式版拍图 / 测试
用单独 APPDATA 目录启动即可不碰本机配置；但桌面 ProxySplit.lnk 会被改指向临时 exe（程序启动时确保快捷方式），拍完要删 / 还原。
- 开发版（appVersion=dev）无授权、不建桌面快捷方式。
- 测免登录下载：用临时 APPDATA 启动带凭据的副本，测完删桌面快捷方式。
