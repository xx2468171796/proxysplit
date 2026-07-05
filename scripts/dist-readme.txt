ProxySplit — 应用分流代理

用法：
1. 右键 proxysplit.exe → 以管理员身份运行（WinDivert 需要加载驱动）。
2. 节点页签：粘贴分享链接（vless/vmess/trojan/ss）→ 解析并添加 → 选中一个节点。
3. 应用分流页签：添加要走代理的程序（如 curl.exe / code.exe），或从运行列表里选。
4. 点右上角「启动」。被选中的程序走节点，其它程序照常直连，不影响系统。

验证：终端里跑  curl https://ipinfo.io/ip  ，返回节点出口 IP 即成功。

注意：这是单文件，内核(sing-box)与驱动(WinDivert)已内嵌，首次运行会自动释放到
%APPDATA%\proxysplit\bin。当前版本只处理 TCP、DNS 为本地解析（详见项目 README 待办）。
