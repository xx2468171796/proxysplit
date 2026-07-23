# ProxySplit 发布与授权安全基线

## 信任边界

- 用户名、密码哈希、套餐、到期时间、设备数、封禁状态和版本下限只由服务端决定。
- 客户端只保存短期 access/refresh token 和 Ed25519 签名租约；保存文件使用 Windows DPAPI 加密。
- 客户端只嵌入授权验签公钥、API 地址和可选 TLS SPKI 摘要，不嵌入数据库口令、JWT 密钥或签名私钥。
- 节点、订阅、应用规则和代理密码继续只保存在用户本机，不上传商业服务。

## 已实施

- 密码：Argon2id（64 MiB、3 轮、单并行）。
- 会话：15 分钟 access token；refresh token 单次轮换；重放会吊销整个 token family；退出登录服务端吊销。
- 设备：指纹用途隔离后 SHA256；PostgreSQL 事务 + advisory lock 防并发绕过设备上限。
- 租约：Ed25519 签名，24 小时在线租期，最多 72 小时离线宽限，并携带设备、套餐、功能、到期和最低版本。
- 客户端：租约严格验签、期限/宽限/最低版本检查，商业构建启动和启动代理前都校验授权。
- 网络：生产 API 必须 HTTPS；商业构建可固定 TLS 证书公钥摘要。
- 构建：`-trimpath -s -w`，商业构建强制 Wails/Go 混淆，生成 SHA256 发布清单，可选 Authenticode 签名并在出包时复验。
- 后台：所有管理 API 均在服务端校验管理员角色；用户、续费、设备和版本操作写审计日志。

## 生产发布

1. 在隔离机器执行 `cd server; pnpm keys:generate`，将私钥导入生产密钥管理器，只将公钥交给客户端构建机。
2. 生产设置固定的 `ACCESS_TOKEN_SECRET`、`LICENSE_PRIVATE_KEY_PEM`、PostgreSQL/Redis 密码；禁止提交 `.env` 和 `server/secrets/`。
3. API 置于 TLS 反向代理后，只允许后台域名通过 CORS；数据库和 Redis 不暴露公网。
4. 商业客户端构建：

   ```powershell
   .\scripts\build.ps1 -Version 1.9.0 -Commercial `
     -CommercialAPIURL https://api.example.com `
     -LicensePublicKeyFile .\server\secrets\license-public.pem `
     -TLSSPKISHA256 <64位十六进制SPKI摘要> `
     -SigningThumbprint <Windows代码签名证书指纹>
   ```

5. 将生成的 exe、manifest SHA256 和 Authenticode 验证结果登记到后台发布记录，再灰度投放。

## 现实边界

客户端软件无法做到“绝对不可反编译”。混淆、剥离符号、TLS pin、DPAPI 和代码签名只能提高篡改成本；真正不可绕过的到期、封禁、设备数和售卖权益必须始终由服务端控制。签名私钥泄漏时应立即轮换并发布内置新公钥的强制升级版本。
