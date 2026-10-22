# 应用识别层 appid：应用库（模拟器预设）+ 逐应用连接监测（v1.9.78 起）

> 代码 internal/appid（catalog.go 应用库、discover*.go 自动发现、monitor.go 采集与判定、query.go 查询/按目录汇总/按网站汇总、verdict.go 判定规则），internal/core/config.go（dir: 规则 → process_path_regex），internal/service/appmonitor.go，app_appmonitor.go，前端 frontend/src/features/apps（catalog-dialog / custom-app-dialog / app-monitor-dialog / monitor-summary / monitor-hosts-table / app-access-table / monitor-view.ts / probe-panel）、state/app-monitor.ts。

## 分层
- 业界做法：Clash/mihomo、sing-box 都是 TUN + 系统连接表按进程名/路径匹配，Proxifier v4 用 WFP 驱动（需微软签名）；都没有「应用 = 一组进程」，这是我们识别层补的。Wireshark 只能旁路看包、不知道进程，不能拿来分流。
- 捕捉 = sing-box TUN + process_name（不自写 WFP 驱动：无驱动签名装不上）；代理 = outbounds；识别 = internal/appid，夹在两者和规则之间。
- 应用库：一个「应用」对应多个进程。内置雷电 / MuMu / 蓝叠 / 夜神 / 逍遥，用户自定义存在 config.customApps（appid.NormalizeCustom 校验，最多 100 个、每个 30 个进程）。前端「应用库」按应用一键把全部进程加进应用规则（已有的跳过）。
- 模拟器原理：NAT 模式下安卓内所有 App 的流量都由宿主 VM 进程发出，按进程名就能抓；桥接模式抓不到；多开同名进程分不开（要分就用端口代理）。内置进程名来自 Proxifier / 各模拟器教程，界面进程（dnplayer、MuMuPlayer）不带客机流量已去掉。**雷电 14（ldplayer9box，本机 Hyper-V）2026-10-22 真机实测**：装完首次启动客机流量在 VBoxNetNAT.exe，ldconsole reboot 后在 Ld9BoxHeadless.exe（91 条连接、40 条经节点成功）→ 预设两个都带。MuMu / 蓝叠 / 夜神 / 逍遥未真机实测。

## 按目录识别（自动识别，2026-10-22）
- 应用规则 match 以 `\` 结尾 = 整个目录：service 转成 core.DirPrefix("dir:")+目录，core 生成 process_path_regex（`(?i)^目录\\`，不会误配同前缀的兄弟目录）；限定目标的规则同样支持；换规则时断开旧连接（matchesProc）也按目录。
- 应用库打开时 appid.Discover：读注册表卸载项（HKLM/WOW6432Node/HKCU 的 DisplayName 匹配 + InstallLocation/图标/卸载程序目录）+ Program Files 下的独立虚拟机目录（雷电 ldplayer9box）+ 正在运行的已知进程目录（便携版）。检测到就按目录加，没检测到才按进程名加。
- 目录安全（appid.CheckDir，规则保存 / 自定义应用 / 自动发现 / 立即检测四处共用）：必须完整路径；不能是 Windows 目录及其子目录；不能是 Program Files、ProgramData、AppData、用户目录、盘符根这类共享根；不能包含 ProxySplit 自己的程序目录和内核目录（启动时 SetProtected）。立即检测只允许已有的目录规则。
- 已知取舍：同一程序既命中目录规则又命中单程序规则时，按线路规则集顺序决定（没做优先级）；目录汇总的健康度是合并算的，目录里某个辅助程序一直失败也会让整体显示「部分失败」。
- 2026-10-22 第二次装雷电 14 真机实测：-discover 只靠 Program Files 下的 ldplayer9box 就认出来（安装器还没写卸载项）；整目录规则 76 条连接、0 失败，按目录立即检测 204 走节点，临时检测目录已自动删除。
- 自定义应用可填目录（完整路径、非 .exe 的行算目录，不能是盘符根）。
- 「立即检测」对目录规则：在该目录下临时建 .proxysplit-probe-* 子目录放改名的 curl，测完删除。
- diagrun -discover 打印本机检测结果；-app 可直接写目录（`"C:\Program Files\ldplayer9box\=global"`）。

## 监测（日志 + 连接表合并，2026-10-22 本机真机实测后重写）
- 只靠每 2 秒轮询 clash /connections 不行：实测 0.3 秒的请求整条漏掉，轮询时还没数据的短连接被误判失败。
- 现在两路合并（appid.Monitor）：内核 info 日志（service.log → OnLog）给每条连接的编号、源端口、目标、进程、出口和 ERROR；每秒读 /connections 补流量和域名；按「源端口|目标」对上。
- 判定：收到数据 = 成功；该连接有 ERROR/WARN = 失败（带原因）；在连接表里活了 ≥3 秒仍 0 字节就断 = 失败（无响应）；认出进程但从没出站 = 拦截；其余很快结束的 = 完成（不算失败）。
- 走节点的连接在远端失败时内核不写错误，只能靠「无响应」规则抓。日志级别高于 info 时退化为只看连接表。
- 界面三层（参考 Little Snitch / 资源监视器 / Charles）：一句话结论 → 关键数字 + 出口分布 + 联网程序 → 立即检测 → 状态视图（全部/失败/正常/进行中/拦截）+ 搜索 + 按网站/全部连接/相关日志；按网站默认，失败的排前，失败原因先说人话（monitor-view.plainReason）再在提示里给原文；点网站看它的每条连接；可暂停刷新。
- 每进程访问日志最多 1000 条、最多跟踪 500 个进程；详情里「失败相关的内核日志」= 含失败目标的 WARN/ERROR 行。「立即检测」复用 RouteTest。
- 真机里看到的「拦截」多为 QUIC（UDP 443，配置 BlockQUIC 有意拦截，应用自动回落 TCP），监测里带说明不算失败；经 twpro 的 UDP（NTP 48 字节）无回包会记为失败，属实。
- 实测方法：cmd/diagrun 加 -test 或 -hold <时长> 时输出 appMonitor（每个 -test / -app 进程的统计和访问日志）；-hold 期间可用 ldconsole reboot 让模拟器产生真实流量；本机管理员 shell 可直接跑（先确认本机没有正在跑的 sing-box/TUN）。
