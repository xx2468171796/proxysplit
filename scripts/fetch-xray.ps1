# Fetch the Xray sidecar pinned in bin/xray-release.json (called by fetch-core.ps1).
# url = Gitea generic package gonggong/generic/xray/<version>/xray-windows-amd64.exe
# (built by scripts/build-xray.ps1); "urlAuth": "gitea" sends GITEA_TOKEN.
# A missing artifact is a warning, not an error: the client then downloads
# Xray on first need. -Require makes it fatal (release builds).
param([switch]$Require)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'bin\xray-release.json') | ConvertFrom-Json
$destination = Join-Path $root 'bin\xray.exe'
function Fail([string]$msg) { if ($Require) { throw $msg } else { Write-Warning "$msg (Xray will not be bundled)"; exit 0 } }
if (-not $release.sha256 -or $release.sha256.Length -ne 64) { Fail 'bin/xray-release.json has no sha256 yet' }
if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $release.sha256) {
    Write-Host "Pinned Xray $($release.version) is already present."
    exit 0
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('proxysplit-xray-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $curlArgs = @('--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '300')
    if ($release.urlAuth -eq 'gitea') {
        if (-not $env:GITEA_TOKEN) { Fail 'GITEA_TOKEN is required to download Xray (bastion asset "Gitea · xuan 全局 token")' }
        $curlArgs += @('-H', "Authorization: token $($env:GITEA_TOKEN)")
    }
    $binary = Join-Path $scratch 'xray.exe'
    & curl.exe @curlArgs $release.url -o $binary
    if ($LASTEXITCODE -ne 0) { Fail "Xray download failed: $($release.url) (uploaded yet? see docs/memory/core-update.md)" }
    if ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.sha256) { throw 'Xray EXE SHA256 mismatch' }
    Copy-Item -LiteralPath $binary -Destination $destination -Force
    Write-Host "Verified Xray $($release.version): $($release.sha256)"
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^proxysplit-xray-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
