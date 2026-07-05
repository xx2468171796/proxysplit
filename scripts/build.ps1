# Builds the self-contained app (runtime binaries embedded via go:embed) and
# drops the loose files into output\ : a single proxysplit.exe you double-click.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\go\bin;$env:Path"
$env:CGO_ENABLED = "0"

Write-Host "==> wails build" -ForegroundColor Cyan
& "$env:USERPROFILE\go\bin\wails.exe" build
if ($LASTEXITCODE -ne 0) { throw "wails build failed" }

$exe = Join-Path $root "build\bin\proxysplit.exe"
$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "==> built proxysplit.exe ($mb MB, self-contained)" -ForegroundColor Green

$out = Join-Path $root "output"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $exe (Join-Path $out "proxysplit.exe") -Force
Copy-Item (Join-Path $root "scripts\dist-readme.txt") (Join-Path $out "README.txt") -Force

Write-Host "==> output:" -ForegroundColor Green
Get-ChildItem $out | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}} -AutoSize
