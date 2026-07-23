ProxySplit 便携版

1. 双击 proxysplit.exe 即可运行，无需安装。
2. 首次启动会在 %APPDATA%\proxysplit 下生成配置。
3. 登录会员账号后即可选择套餐、启用代理与应用分流。
4. 启用系统代理 / TUN 需要以管理员身份运行。

升级：用新版 exe 覆盖旧文件即可。配置与订阅数据（config.json / proxysplit-data.json）
保留在 %APPDATA%\proxysplit，覆盖前会自动备份为 .bak。

本程序内置 sing-box 内核；正式发布包经 Garble 混淆并附带 Ed25519 自动更新签名。
各版本的 SHA256 记录在对应的 proxysplit-v<版本>.manifest.json 中。
