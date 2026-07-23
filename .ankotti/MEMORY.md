# ProxySplit 项目状态

- 当前发布版：`v1.7.2`，产物为 `output/proxysplit-v1.7.2.exe`。
- 配置主存储：`%APPDATA%/proxysplit/config.json`；同时保留 `.bak` 和 exe 同目录 `proxysplit-data.json`。
- v1.7.2 根治“退出重开后节点/规则界面为空”：Wails 会在 `OnStartup` 完成前开放前端绑定，旧版首批 `GetNodes/GetAppRules` 在 `svc == nil` 时 panic，JS Promise 永久不返回；新增后端 readiness channel，`GetBootstrapState` 等到 `service.New` 读完配置后才返回完整快照，`OnDomReady` 也通过同一屏障推送快照。
- “只添加一个却出现别的节点”并非重复导入：旧节点一直在配置文件中，只是启动界面没显示；添加动作触发刷新后，原有节点一起显示。
- 完整隔离 GUI 验收：从全新配置开始，通过软件界面手动添加 SOCKS 节点 `127.0.0.1:1080` 和应用 `E2E-PERSIST-APP.exe`，关闭到托盘改为关闭后执行正常窗口退出，再以相同配置启动；节点页仍显示该节点，应用分流页仍显示 1 条该应用规则，证明“新增→退出→重开”全链路持久化有效。
- 用户真实配置未用于隔离测试；测试结束后重新启动正式 `output/proxysplit-v1.7.2.exe`，真实配置仍为 3 个节点、4 条应用规则。
- 验证截图：`output/v1.7.2-e2e-node-after-clean-restart.png`、`output/v1.7.2-e2e-app-after-clean-restart.png`。
- 自动验证：`go test ./...`；`npm run check` 为 0 errors（15 个既有无障碍/CSS warnings、3 hints）；Wails production build `Devtools=false`。
- 发布脚本：`scripts/build.ps1 -Version x.y.z`，会注入窗口/API 版本号并同时生成带版本号产物及 `proxysplit.exe` 便捷副本。
- UI 重排原型待用户确认：`docs/prototypes/ProxySplit-UI-Prototype-v2.html`，便捷预览副本为 `output/ProxySplit-UI-Prototype-v2.html`。原型含概览、节点、应用分流、分流规则、订阅、日志、设置 7 个可点击页面；用户确认前不要改正式前端。
