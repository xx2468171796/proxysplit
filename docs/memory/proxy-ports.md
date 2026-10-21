# 端口代理（指纹浏览器 / 局域网客户端，v1.9.77 起）

> 代码 internal/core/portconfig.go、portproc.go，internal/service/proxyports.go、proxyports_monitor.go，app_proxyports.go，前端 frontend/src/features/ports。

## 结论
- 一套独立模式，和「应用分流」同时开、互不影响：每个端口一个独立 sing-box 进程（配置 <数据目录>/proxyports/port-<id>.json），任意多个同时开，单独启停。
- 每个端口：协议 mixed/socks/http、仅本机或局域网（0.0.0.0）、可选账号密码、节点（空 = 跟随当前选中节点，换节点时自动重启这些端口）、模式 规则/全局/直连（走该进程自己的 clash API 热切，不影响别的端口）。
- 设备 / 连接 / 访问日志：每 2 秒读各端口 clash /connections，按来源 IP 聚合（portMonitor）；内核日志每端口一个 logRing。
- 开启的端口随软件启动自动开，退出时全关；授权校验（startGuard）同样适用。

## 坑与约束
- 主核心 killStrays 会杀同路径的所有 sing-box：已按命令行排除含 proxyports 的进程；端口孤儿由 KillPortStrays 在 service.New 里同步清理（必须在任何端口启动前）。
- 端口进程出站带 auto_detect_interface，但主 TUN 仍会抓到它：BuildTUNConfig 在有端口时加 process_path=<sing-box 路径> → direct，避免全局下套两层节点；第一个端口建好时若主核心在跑会自动重启一次。
- 启停全部经 startPort / stopPort，在每端口 life 锁里先停后起；StopProxyPorts 置 closed 后不再允许启动（审计发现过孤儿进程与 mutex 覆盖崩溃，见 proxyports_test.go）。
- 防火墙规则「ProxySplit 端口代理」只放行局域网端口的 TCP、来源限私网段；端口列表变化时重建，没有局域网端口时删除。
- 软件被强杀时端口进程会留到下次启动才清（没用 Job 对象）。

## 更新说明弹窗（同版加入）
- release_notes.go 把 CHANGELOG.md 打进程序；seen-version.txt 记已看版本，升级后首次打开弹出新版本条目（最多 5 版），赞赏码弹窗排在它后面。
- 全新安装不弹（启动时在 service.New 之前判断 config.json 是否存在）。所以每次发版 CHANGELOG 写给用户看的条目即可。
