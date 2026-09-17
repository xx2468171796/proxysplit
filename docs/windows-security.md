# Windows 安全中心告警与发布验证

## 当前处理

- 从 v1.9.52 开始，正式构建默认关闭 Garble 混淆；项目没有 UPX 加壳步骤，有完整源码，无需对 EXE 脱壳。
- 内核使用 SagerNet 官方稳定版，下载 ZIP 和解压 EXE 分别按 `bin/core-release.json` 的 SHA256 核验；打包时再次核对。
- 商业授权和 Ed25519 自动更新验签继续保留。**Ed25519 更新签名不等于 Windows Authenticode 签名**，不能消除“未知发布者”或 SmartScreen 信誉提示。
- 不关闭杀毒、不添加排除项，也不把“能运行”当作“无病毒”证明。

## 获取证据

在实际出现告警的 Windows 机器上，记录保护历史中的威胁名称、文件完整路径、检测时间。扫描前保留正式发布清单，用哈希区分客户端、内核及被篡改的下载。

```powershell
.\scripts\diagnose-defender.ps1 -File .\output\proxysplit-v1.9.52.exe -Scan
.\scripts\diagnose-defender.ps1 -File .\bin\sing-box.exe -Scan
```

报告会保存在目标旁边的 `.defender.json`，包括 SHA256、签名状态、Defender 状态及检测记录。扫描可能按现有策略隔离文件。Defender 不可用时报告标明未验证，不能视为通过。

## 正式代码签名

使用受信任 CA 签发、属于实际发布者的代码签名证书；私钥留在证书存储、硬件令牌或签名服务中，不提交仓库。不使用自签名证书冒充受信任发布者。

```powershell
.\scripts\build-commercial.ps1 -Version 1.9.52 -SigningThumbprint '<证书指纹>' -SignToolPath '<signtool.exe 路径>'
```

构建先进行 Authenticode 签名和时间戳、验证签名，再计算最终 EXE 的 SHA256 和 Ed25519 发布签名，保证自动更新校验的是最终文件。

## 确认为误报后的渠道

将准确的告警名称、SHA256、官方下载来源和对应构建版本提交微软软件开发者分析入口：
https://www.microsoft.com/en-us/wdsi/filesubmission

提交的是程序文件，不附带用户节点、订阅、账号票据、配置或私钥。最终是否撤销检测由微软分析结果决定；代码签名及去混淆均不能保证所有引擎不再告警。

## 本次环境限制

2026-09-17 构建机器没有可用的 Defender PowerShell/CIM 接口、扫描程序或检测日志，也未发现可用的代码签名证书。因此只能验证来源、构建和功能，不能声明已经通过 Defender 扫描。实际告警名称仍待收集。
