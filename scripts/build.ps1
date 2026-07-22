# Builds the self-contained app (runtime binaries embedded via go:embed) and
# drops a clearly versioned exe into output\.  Pass -Version 1.7.1; when omitted
# the script derives the next patch version from the newest v* git tag.
param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ([string]::IsNullOrWhiteSpace($Version)) {
    $lastTag = (git tag --sort=-version:refname | Select-Object -First 1)
    if ($lastTag -match '^v(\d+)\.(\d+)\.(\d+)$') {
        $Version = '{0}.{1}.{2}' -f $Matches[1], $Matches[2], ([int]$Matches[3] + 1)
    } else {
        $Version = "0.1.0"
    }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must look like 1.7.1 (got '$Version')"
}

$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\go\bin;$env:Path"
$env:CGO_ENABLED = "0"

Write-Host "==> wails build (hardened: stripped symbols + no debug/paths)" -ForegroundColor Cyan
# Anti-decompile hardening (safe for Wails — does NOT rename methods so the
# JS<->Go bindings keep working):
#   -s -w    strip the symbol table + DWARF debug info (no function names)
#   -trimpath  remove local source paths from the binary
& "$env:USERPROFILE\go\bin\wails.exe" build -trimpath -ldflags "-s -w -X main.appVersion=$Version"
if ($LASTEXITCODE -ne 0) { throw "wails build failed" }

$exe = Join-Path $root "build\bin\proxysplit.exe"
$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "==> built proxysplit.exe ($mb MB, self-contained)" -ForegroundColor Green

$out = Join-Path $root "output"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$versionedExe = Join-Path $out "proxysplit-v$Version.exe"
Copy-Item $exe $versionedExe -Force
# Keep the unversioned convenience copy in sync, but the versioned file above is
# the release artifact users should run/share.
Copy-Item $exe (Join-Path $out "proxysplit.exe") -Force
Copy-Item (Join-Path $root "scripts\dist-readme.txt") (Join-Path $out "README.txt") -Force

Write-Host "==> release: $versionedExe" -ForegroundColor Green
Get-Item $versionedExe, (Join-Path $out "proxysplit.exe") | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}, LastWriteTime -AutoSize
