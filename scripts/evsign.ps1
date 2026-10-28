# EV Sign shared code signing (bastion asset 251): send the exe to api.evsign.cn for an
# Authenticode signature and replace the file only when the result verifies.
# The license comes only from the EVSIGN_KEY environment variable (never the repo or argv).
# The file name must be on EV Sign's reviewed list (proxysplit.exe is).
# Keep this file ASCII: Windows PowerShell 5.1 misreads BOM-less UTF-8.
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
