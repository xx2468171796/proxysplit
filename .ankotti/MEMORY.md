# ProxySplit 项目状态

- 当前发布版：`v1.7.1`，产物为 `output/proxysplit-v1.7.1.exe`。
- 配置主存储：`%APPDATA%/proxysplit/config.json`；同时保留 `.bak` 和 exe 同目录 `proxysplit-data.json`。
- 已修复“退出重开后节点/规则显示为空”：启动时等待 Wails 绑定和后端 RPC 真正成功后再替换界面，失败持续重试；窗口重新获得焦点时也重新读取。
- 发布脚本：`scripts/build.ps1 -Version x.y.z`，会注入窗口/API 版本号并同时生成带版本号产物及 `proxysplit.exe` 便捷副本。
- v1.7.1 已做两次进程启动验证：配置和 API 均稳定读回 3 个节点、4 条应用规则，选中节点保持为 `dmit0001`。
