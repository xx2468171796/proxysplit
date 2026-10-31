# macOS 版（Apple 芯片，2026-10-28 起）

> 同一套代码、同一个版本号；平台差异都在 `*_darwin.go` / `*_windows.go` / `*_other.go`。

## 和 Windows 不一样的地方
| 方面 | macOS 做法 | 代码 |
|---|---|---|
| 内核 | 两个内核都内置：Xray 26.10.29（bin/darwin/xray-release.json，scripts/build-xray-darwin.sh）+ 自编 sing-box 1.14.3-relayops.1 darwin/arm64（与 windows 同补丁同标签，见 bin/darwin/core-release.json）；`scripts/fetch-core-darwin.sh` 取到 bin/darwin/sing-box 再嵌进 app | payload_darwin.go |
| root | TUN 要 root。首次连接弹一次系统密码框，装 root 专属目录 `/Library/PrivilegedHelperTools/proxysplit`（psctl + check.js + 授权时复制的 sing-box）和 `/etc/sudoers.d/proxysplit`（本用户只能免密跑 psctl）。root 只跑这份内核副本；配置复制进去后由 check.js（JXA）校验：拒绝会写文件的选项（字段名按 Go 大小写不敏感规则比较），cache 路径改到该目录。psctl 带版本号（`ctlVersion`），脚本一改就重新授权；内核更新后也要再授权一次 | internal/macpriv |
| 停内核 | 授权时还装开机任务 `/Library/LaunchDaemons/cn.zygskins.proxysplit.dnsrestore.plist`（开机跑一次 `psctl stop`），重启 / 强杀后 DNS 也能复原（2026-10-28 真机强杀 + kickstart 验证）。psctl 是内核的父进程：sudo 把 SIGTERM 转给 psctl，psctl 再转给内核，等它退出后恢复 DNS；`psctl stop` 按 core.pid 杀并恢复 DNS（程序启动时也会调用）。不能 SIGKILL sudo（会留下 root 孤儿） | internal/core/tuncmd_darwin.go |
| DNS | macOS 的 DNS 查询由 mDNSResponder 按网卡绑定发出，不进 TUN，接管不到。内核运行期间 psctl 把每个网络服务的 DNS 设成 TUN 地址 +1（如 172.19.0.2，53 端口被 hijack-dns 接管），原值存 dns.bak（只在不存在时写），内核退出 / stop / 程序启动时恢复。已知限制：Mac 上 Tailscale 开着「Use Tailscale DNS」时它的 DNS 优先，接管不到（客户一般不用 Tailscale） | internal/macpriv |
| 抓流量 | 没有 WinDivert：默认模式在 macOS 就是 TUN + 按应用规则（`Settings.ProcessCapture()` 非 Windows 恒 false） | capture_svc.go |
| 应用规则 | 进程按 .app 归组；整个应用的规则存成 `/Applications/X.app/`（appid.NormDir 按平台加分隔符；不能选 /System、/Applications 根、用户主目录等共享目录，/System/Applications 下的 .app 可以）；规则 match 是 `.app` 路径（或以 / 结尾）= 整个目录（`process_path_regex ^/Applications/X\.app/`，区分大小写），Chrome 的 Helper 也命中；命令行程序（node、claude）按进程名 | internal/proc/list_darwin.go、core.DirRegex、service.IsDirRule |
| Tailscale | TUN `route_exclude_address` 排除 100.64.0.0/10 和 fd7a:115c:a1e0::/48，经 Tailscale 远程管理的 Mac 不会失联 | internal/core/tunexclude.go |
| 系统代理 | networksetup（经 psctl），所有启用的网络服务；读用 `scutil --proxy` | internal/sysproxy/sysproxy_darwin.go |
| 开机自启 | `~/Library/LaunchAgents/cn.zygskins.proxysplit.plist`（--background） | internal/autostart/autostart_darwin.go |
| 托盘 | 暂无（energye/systray 与 Wails 抢主线程事件循环）：关窗口 = 退出（会停内核、清系统代理） | tray_other.go |
| 更新 | `/v1/releases/latest?platform=macos`，包是 ProxySplit.app 的 zip；装法：等旧进程退出 → ditto 解压 → 换 .app → `open -n --args --updated` → 60 秒内没写健康标记就换回旧版 | internal/updater/apply_darwin.go |
| 内核更新 | 不跟随面板自动更新（面板只有 Windows 内核），Mac 内核随 App 发版 | internal/service/corefollow.go |
| 未做 | AI 劫持（NRPT 是 Windows 的）、路由测试（借 Windows curl.exe）、WinDivert 相关、桌面快捷方式 | 各 `_other.go` 返回不支持 |

## 构建（在 Mac 上）
- 构建机 `xuan-macbook-air`，离线时用业主的 `mac-studio`（~/ankotti-build，Go 在 ~/sdk/go/bin，内核文件在本机下载后传过去，用 CORE_SRC / XRAY_SRC 指定）；（同事的 iOS 开发机：先确认没在跑 Xcode，用 nice）；Go / pnpm / Xcode / wails 已装，目录 `~/ankotti-build/proxysplit`。
- 前端在 Windows 编（私有包在 Gitea）：`pnpm --dir frontend build`，源码连 frontend/dist 打包传过去（只排除 .git、node_modules、server、website、*.exe）。
- 正式版：`VERSION=x.y.z sh scripts/build-macos.sh` → build/bin/ProxySplit.app（ad-hoc 签名，没有苹果开发者账号）+ `ProxySplit-v<版本>-macos-arm64.zip`；编译参数取 build/release-kit/profile.json（与 Windows 正式版同一份）。
- APFS 不分大小写：proxysplit.app 和 ProxySplit.app 是同一个目录，改名要经临时名。
- 用户首次打开：ad-hoc 签名没有公证，Finder 会拦——右键「打开」一次，或 `xattr -dr com.apple.quarantine ProxySplit.app`。

## 发版
- releases 表按平台分（迁移 0018，唯一键 version+platform）：同一版本号 Windows 一条（.exe）、macOS 一条（`platform='macos'`，url 以 .zip 结尾，签名同 Windows：`SigningMessage(version, sha256, url)`）。
- 下载文件名：`ProxySplit-v<版本>-macos-arm64.zip`、`proxysplit-macos-latest.zip`（/v1/download 白名单已加）。

## 真机测试（xuan-macbook-air，同事的工作电脑）
- 步骤和坑见堡垒机机器笔记「公司常驻服务与构建」：改网络的测试要用 nohup 跑、结束时 trap 恢复小火箭；ProxySplit 运行时别改 Tailscale 设置。
- 2026-10-28 实测通过：授权安装、TUN 按应用（命令行进程名、整个 Chrome.app）、DNS 接管与恢复、系统代理开关、停止无残留、正式版登录。

## 发 Mac 版的步骤（2026-10-29 v1.11.1 实测）
1. Windows 正式版先发（release-all 会编好 frontend/dist）；`git archive HEAD -- . ':!server' ':!website'` 再追加 frontend/dist 打包，transfer_link 传到 Mac `~/ankotti-build/`，解到新目录，bin/darwin 的 sing-box / xray 从旧目录拷过来。
2. Mac 上 `VERSION=x.y.z nice -n 10 sh scripts/build-macos.sh`（PATH 加 ~/go/bin、/opt/homebrew/bin），跑 configsync / license / updater 测试。
3. zip 拉回本机，`go run ./cmd/releasesign -private-key <资产116写的临时文件> -version x.y.z -sha256 <zip sha> -url https://proxysplit.zygskins.cn/download/ProxySplit-vx.y.z-macos-arm64.zip`，用完删私钥。
4. zip 传 sz 该版 incoming 目录 → install 到 downloads → 原子替换 proxysplit-macos-latest.zip（旧的存 previous/）→ releases 插 platform='macos' 行 + audit_logs → 飞牛验 `latest?platform=macos` 与两个下载地址 sha。
