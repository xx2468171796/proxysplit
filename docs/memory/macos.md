# macOS 版（Apple 芯片，2026-10-28 起）

> 同一套代码、同一个版本号；平台差异都在 `*_darwin.go` / `*_windows.go` / `*_other.go`。

## 和 Windows 不一样的地方
| 方面 | macOS 做法 | 代码 |
|---|---|---|
| 内核 | 自编 sing-box 1.14.3-relayops.1 darwin/arm64（与 windows 同补丁同标签，见 bin/darwin/core-release.json）；`scripts/fetch-core-darwin.sh` 取到 bin/darwin/sing-box 再嵌进 app | payload_darwin.go |
| root | TUN 要 root。首次连接弹一次系统密码框，装 `/usr/local/libexec/proxysplit-psctl`（root 所有）+ `/etc/sudoers.d/proxysplit`（本用户只能免密跑这个脚本）。脚本只做：跑本用户 `~/Library/Application Support/proxysplit/bin/sing-box run -c *.json`、停内核、开关系统代理 | internal/macpriv |
| 停内核 | TUN 内核在 sudo 下：先 SIGTERM（sudo 会转给 sing-box），再 `psctl stop` 兜底；不能 SIGKILL sudo（会留下 root 孤儿） | internal/core/tuncmd_darwin.go |
| 抓流量 | 没有 WinDivert：默认模式在 macOS 就是 TUN + 按应用规则（`Settings.ProcessCapture()` 非 Windows 恒 false） | capture_svc.go |
| 应用规则 | 进程按 .app 归组；规则 match 是 `.app` 路径（或以 / 结尾）= 整个目录（`process_path_regex ^/Applications/X\.app/`，区分大小写），Chrome 的 Helper 也命中；命令行程序（node、claude）按进程名 | internal/proc/list_darwin.go、core.DirRegex、service.IsDirRule |
| Tailscale | TUN `route_exclude_address` 排除 100.64.0.0/10 和 fd7a:115c:a1e0::/48，经 Tailscale 远程管理的 Mac 不会失联 | internal/core/tunexclude.go |
| 系统代理 | networksetup（经 psctl），所有启用的网络服务；读用 `scutil --proxy` | internal/sysproxy/sysproxy_darwin.go |
| 开机自启 | `~/Library/LaunchAgents/cn.zygskins.proxysplit.plist`（--background） | internal/autostart/autostart_darwin.go |
| 托盘 | 暂无（energye/systray 与 Wails 抢主线程事件循环）：关窗口 = 退出（会停内核、清系统代理） | tray_other.go |
| 更新 | `/v1/releases/latest?platform=macos`，包是 ProxySplit.app 的 zip；装法：等旧进程退出 → ditto 解压 → 换 .app → `open -n --args --updated` → 60 秒内没写健康标记就换回旧版 | internal/updater/apply_darwin.go |
| 未做 | AI 劫持（NRPT 是 Windows 的）、路由测试（借 Windows curl.exe）、WinDivert 相关、桌面快捷方式 | 各 `_other.go` 返回不支持 |

## 构建（在 Mac 上）
- 构建机 `xuan-macbook-air`（同事的 iOS 开发机：先确认没在跑 Xcode，用 nice）；Go / pnpm / Xcode / wails 已装，目录 `~/ankotti-build/proxysplit`。
- 前端在 Windows 编（私有包在 Gitea）：`pnpm --dir frontend build`，源码连 frontend/dist 打包传过去（只排除 .git、node_modules、server、website、*.exe）。
- 正式版：`VERSION=x.y.z sh scripts/build-macos.sh` → build/bin/ProxySplit.app（ad-hoc 签名，没有苹果开发者账号）+ `ProxySplit-v<版本>-macos-arm64.zip`；编译参数取 build/release-kit/profile.json（与 Windows 正式版同一份）。
- APFS 不分大小写：proxysplit.app 和 ProxySplit.app 是同一个目录，改名要经临时名。
- 用户首次打开：ad-hoc 签名没有公证，Finder 会拦——右键「打开」一次，或 `xattr -dr com.apple.quarantine ProxySplit.app`。

## 发版
- releases 表按平台分（迁移 0018，唯一键 version+platform）：同一版本号 Windows 一条（.exe）、macOS 一条（`platform='macos'`，url 以 .zip 结尾，签名同 Windows：`SigningMessage(version, sha256, url)`）。
- 下载文件名：`ProxySplit-v<版本>-macos-arm64.zip`、`proxysplit-macos-latest.zip`（/v1/download 白名单已加）。
