# ProxySplit 正式版打包资料

这里保存其他 AI 执行正式打包所需的**可公开构建输入**：

- 授权验签公钥
- 自动更新验签公钥
- 生产 TLS SPKI 固定值
- 正式 API、下载地址和本机私钥引用

正式发布只需在仓库根目录执行：

```powershell
.\scripts\build-commercial.ps1 -Version x.y.z
```

仅检查环境和构建资料：

```powershell
.\scripts\build-commercial.ps1 -Version x.y.z -CheckOnly
```

正式产物输出到：

```text
output/proxysplit-vx.y.z.exe
output/proxysplit-vx.y.z.manifest.json
output/proxysplit.exe
```

## 私钥说明

发布签名私钥位于本机：

```text
server/secrets/shenzhen-release-private.pem
```

该目录被 `.gitignore` 排除。私钥平时不留在本机：构建前从堡垒机资产 116 取出写到这里，
构建完立刻删除（做法见 docs/RELEASE-PROCESS.md）。

私钥不能明文提交到当前远程 Git 仓库。否则任何拿到仓库的人都能伪造客户端自动更新，
相当于失去整个客户端发布链的控制权。仓库中的 `profile.json` 保存私钥路径和 SHA256，
包装脚本会在构建前校验完整性。

换电脑时同样从资产 116 取；不能从
GitHub 下载私钥，也不能临时生成新私钥，否则现有客户端不会信任新签名。
