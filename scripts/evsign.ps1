# EV Sign 共享代码签名（堡垒机资产 251）：把 exe 发给 api.evsign.cn 签 Authenticode，验签通过才替换原文件。
# 许可证只从环境变量 EVSIGN_KEY 读，不进仓库、不进命令行。文件名须是 EV Sign 已审核的（proxysplit.exe 已审核）。
param(
    [Parameter(Mandatory = $true)][string]$File,
    [string]$SignedName = 'proxysplit.exe'
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:EVSIGN_KEY)) { throw 'EVSIGN_KEY is not set' }
$tmp = "$File.evsign"
$headers = @{
    'X-Key'       = $env:EVSIGN_KEY
    'X-Action'    = 'api-sign'
    'X-Algorithm' = 'sha256'
    'X-File-Name' = [Uri]::EscapeDataString($SignedName)
}
$ProgressPreference = 'SilentlyContinue'
try {
    Invoke-WebRequest -Uri 'https://api.evsign.cn/v1' -Method Post -Headers $headers -InFile $File `
        -ContentType 'application/octet-stream' -OutFile $tmp -TimeoutSec 900 -UseBasicParsing
    $sig = Get-AuthenticodeSignature -LiteralPath $tmp
    if ($sig.Status -ne 'Valid') { throw "EV Sign result is not validly signed: $($sig.Status) $($sig.StatusMessage)" }
    Move-Item -LiteralPath $tmp -Destination $File -Force
    Write-Host "==> Authenticode (EV Sign): $($sig.SignerCertificate.GetNameInfo('SimpleName', $false))" -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
