# 分流规则 / TUN 配置

> 代码 internal/core（BuildTUNConfig、egress.go、routing_matrix_test.go）、internal/service。规则审计过程见 docs/decisions.md「分流规则两轮审计」与 v1.9.55。

## BuildTUNConfig 规则顺序
顺序固定为：固定直连(API / 内网 / 自身) → 应用拦截 / 直连 → clash 直连 → 局域网 → 屏蔽 QUIC → clash 全局(列出应用走各自节点，其余走 proxy) → 规则模式(细分规则 / 自定义 / 各应用线路)。
- 拦截排在自家接口 / 内网直连之前；阻止 QUIC 只挡进隧道流量（国内 / 直连不挡）。
- 按目标细分的应用规则：直连 / 拦截排在应用直连之后（各代理策略都生效），走节点的排在 clash 直连之后、clash 全局之前。
- 全局自定义规则带 clash_mode=rule：白名单下「代理」规则按组限定进程并走组节点，排在应用直连 / 拦截 / 细分规则之后（以前不限进程，会把列表外应用拉进隧道）；TUN 配置补上 DirectDomains。
- 默认全走代理下，自定义「走代理」规则也按各应用自己的节点；DefaultLine 只在默认全走代理下决定没列出程序的线路（Options.SplitDefault），不允许拦截。
- 自定义线路出口「直连」可保存且真走直连（lineOutbound）。
- 新装默认 RuleMode=whitelist。

## 应用名单热加载
应用进程名单放 <数据目录>/rules/*.json 本地 rule-set，sing-box 改文件即热加载（1.14.1 实测含原子替换）。
- 内置 规则 / 全局@活动节点 两组永远存在，增删改应用配置字节不变，所以 Manager.ApplySplitLists 只写文件不重启，再用 clash API 按进程名断开受影响应用旧连接；sing-box 改文件后约 0.11 秒才生效，故 0.6 秒后再断（ruleSetReloadWait）。
- 组内条件用 logical and（同一条规则里 rule_set 之间是 OR）。
- 空名单用占位进程 proxysplit-none.invalid（空列表 = 无条件 = 全匹配）；占位还有第二个作用：sing-box 只在启动时根据规则集里有没有进程规则决定是否识别进程（SagerNet/sing-box#4341），去掉占位会让之后热加载进来的应用全部失效。
- 整机全局下改应用规则不再重启，白名单下改 DefaultLine 不重启。

## 测试
internal/core/routing_matrix_test.go 用真 sing-box 跑 20 个场景（TUN 换 mixed、节点换假代理、DNS 换 hosts），变异测试能抓到回归。
- 测试要用 sing-box 私有副本，否则 service 测试的 CleanStrays 会杀掉它。
- sing-box CONNECT 在首个数据字节才拨号 / 入 /connections。
- 另有 TestCustomRulesStayInsideWhitelist、TestRoutingMatrixAIOnly、TestRoutingMatrixBlockedList。

## 自定义规则的使用坑
规则写错字是常见原因（用户那台把 zygskins.cn 写成 zygskisn.cn）；Claude / Codex 走国内中转 sub2api.demo.zygskins.cn，本来不需要代理。
- 1.9.70 起有写法说明表 + 输入自动纠正（canonicalRuleInput）。
- *.zygskins.cn 规则命中正常，但台湾节点 → 深圳站点约 1/3 TLS 失败（深圳链路 / WAF，非客户端问题），自家国内站点应设直连。

## 自动更新相关（影响分流重启）
SelectNode / RemoveNode / SetRouting / SetSettings / SetLogLevel 返回重启错误并在界面提示；restart() 在一把 lifecycleMu 下停 + 启，用户中途点停止不会被重新启动。

## 规则库来源（2026-10-22 起）
- 主源是深圳镜像 https://proxysplit.zygskins.cn/rules/（manifest.json + 三个 .srs，sz 每天 05:00 由 proxysplit-rules.timer 从 SagerNet 同步）。客户端 geoupdate.Sync 只走镜像、按 sha256 判断要不要下；手动「更新规则库」用 Update，镜像不行再经节点回退上游。
- 后台同步：service.StartRuleSync（启动 30 秒后、每 6 小时），不需要代理在跑；sing-box 本地 rule_set 文件变化自动重载。
- 镜像出问题先看 sz `journalctl -u proxysplit-rules`；sz 能直连 GitHub，jsDelivr 是兜底源。
