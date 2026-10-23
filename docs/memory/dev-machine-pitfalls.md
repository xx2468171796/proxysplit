# 开发机坑（git / 凭据 / Windows）

## Git 推送
只有一个 remote：origin = Gitea xuan/proxysplit（http://s3.alonelife.top:32109），直接 `git push origin main`。
- Git for Windows 升到 2.56 后，系统 gitconfig 的 credential manager 抢在 store 前且不能弹窗：推 Gitea 用 `git -c credential.helper= -c credential.helper=store push`。
- 推 GitHub（xx2468171796/daili）用堡垒机资产 10 的 PAT 临时 extraheader，不写进 .git/config。
- 节点链接（twpro-中转）存堡垒机资产 id 113，勿写进仓库。

## PATH 与 shell
本机 PowerShell 没有 git / go 的 PATH：git 用 Bash 工具，go 在 C:\tools\go\bin，wails 在 ~/go/bin。
- 在 PowerShell 里直接 `& build-commercial.ps1` 会因 wails 的 stderr 中断并留下私钥文件：用 Bash 调 `powershell.exe -File`，并 trap 删私钥（见 release-process.md）。
- `git archive HEAD:子目录` 要加 `-c core.autocrlf=false`。

## Windows 实现坑
- PowerShell 路径改用环境变量传入：弯引号 ‘’ 会结束 '…' 字符串；WScript.Shell 存不了非 ANSI 字符（ß / emoji），此时只记日志；桌面快捷方式已改 IShellLinkW。
- 开机自启用计划任务，Run 键对 requireAdministrator 程序开机不生效。
- 自动更新：`.old` 被占着删不掉会改名 `.old.<ticks>.stale`，启动清理；更新后新版写 %APPDATA%/proxysplit/started-ok 握手，60 秒内没到就回滚。
- 本机构建环境没有可用 Defender 命令 / CIM / 扫描程序，不能据此宣称已排除误报。

## 自动更新实现要点
更新安装助手只重试换文件；换完启动新版观察 8 秒，起不来就换回旧版重开；旧版据 resume 标记识别安装失败，写 update-failed.json，24 小时内不再自动装同一版本（手动按钮仍可用）；InstallAppUpdate 用 atomic 防自动 / 手动并发。
- 静默更新（1.9.54 起，autoupdate.go）：启动 20 秒后 + 每 6 小时查，AutoUpdateApp 开或版本 mandatory 就自动装；更新前代理在跑会写 %APPDATA%/proxysplit/resume-after-update.json，新版启动后自动恢复，10 分钟过期。1.9.53 及以前只会弹不可关闭的强制升级框。

## 子进程必须藏窗口
Windows 上 exec.Command 起的子进程（powershell、sing-box check、curl）不加 CREATE_NO_WINDOW 会闪黑窗口；v1.9.85 前每次打开软件都闪（设备识别的 PowerShell、内核配置校验）。`-WindowStyle Hidden` 不够。根目录 hidewindow_test.go 会扫出没藏窗口的调用。
