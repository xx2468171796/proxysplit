# Fetch only the reviewed core pinned in bin/core-release.json.
# Two formats:
#   "format": "exe" -> url is the sing-box.exe itself (PowerVPN platform build from the
#                      Gitea generic package gonggong/sing-box); sha256 = the EXE.
#                      "urlAuth": "gitea" sends GITEA_TOKEN (env) as the Authorization header.
#   (default) zip   -> official SagerNet release zip; archiveSha256 + sha256 of the EXE inside.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# WinDivert 2.2.2 (仅接管选中程序, internal/capture): official basil00 release,
# archive and both x64 files pinned by SHA256 (archive hash matches the
# SourceForge mirror listing; WinDivert64.sys carries a valid Authenticode
# signature). Embedded into proxysplit.exe by app.go.
$wd = @{
    url = 'https://github.com/basil00/WinDivert/releases/download/v2.2.2/WinDivert-2.2.2-A.zip'
    archive = '63cb41763bb4b20f600b6de04e991a9c2be73279e317d4d82f237b150c5f3f15'
    files = @{ 'WinDivert.dll' = 'c1e060ee19444a259b2162f8af0f3fe8c4428a1c6f694dce20de194ac8d7d9a2'; 'WinDivert64.sys' = '8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2' }
}
$wdMissing = @($wd.files.Keys | Where-Object {
    $p = Join-Path $root "bin\$_"
    -not (Test-Path -LiteralPath $p) -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wd.files[$_]
})
if ($wdMissing.Count -gt 0) {
    $wdScratch = Join-Path ([IO.Path]::GetTempPath()) ('proxysplit-core-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $wdScratch | Out-Null
    try {
        $zip = Join-Path $wdScratch 'windivert.zip'
        & curl.exe --fail --location --silent --show-error --connect-timeout 15 --max-time 300 $wd.url -o $zip
        if ($LASTEXITCODE -ne 0) { throw 'WinDivert download failed' }
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wd.archive) { throw 'WinDivert archive SHA256 mismatch' }
        Expand-Archive -LiteralPath $zip -DestinationPath $wdScratch
        foreach ($name in $wd.files.Keys) {
            $src = Join-Path $wdScratch "WinDivert-2.2.2-A\x64\$name"
            if ((Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wd.files[$name]) { throw "$name SHA256 mismatch" }
            Copy-Item -LiteralPath $src -Destination (Join-Path $root "bin\$name") -Force
        }
        Write-Host 'Verified WinDivert 2.2.2 (x64).'
    } finally {
        $resolved = [IO.Path]::GetFullPath($wdScratch)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^proxysplit-core-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
$release = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'bin\core-release.json') | ConvertFrom-Json
$destination = Join-Path $root 'bin\sing-box.exe'
if (-not $release.sha256 -or $release.sha256.Length -ne 64) { throw 'bin/core-release.json has no sha256 yet' }
if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $release.sha256) {
    Write-Host "Pinned sing-box $($release.version) is already present."
    exit 0
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('proxysplit-core-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $curlArgs = @('--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '300')
    if ($release.urlAuth -eq 'gitea') {
        if (-not $env:GITEA_TOKEN) { throw 'GITEA_TOKEN is required to download the platform core (bastion asset "Gitea · xuan 全局 token")' }
        $curlArgs += @('-H', "Authorization: token $($env:GITEA_TOKEN)")
    }
    if ($release.format -eq 'exe') {
        $binary = Join-Path $scratch 'sing-box.exe'
        & curl.exe @curlArgs $release.url -o $binary
        if ($LASTEXITCODE -ne 0) { throw 'Core download failed' }
    } else {
        $archive = Join-Path $scratch 'core.zip'
        & curl.exe @curlArgs $release.url -o $archive
        if ($LASTEXITCODE -ne 0) { throw 'Official core download failed' }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.archiveSha256) { throw 'Core archive SHA256 mismatch' }
        Expand-Archive -LiteralPath $archive -DestinationPath $scratch
        $binary = Join-Path $scratch "sing-box-$($release.version)-windows-amd64\sing-box.exe"
    }
    if ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.sha256) { throw 'Core EXE SHA256 mismatch' }
    Copy-Item -LiteralPath $binary -Destination $destination -Force
    Write-Host "Verified sing-box $($release.version): $($release.sha256)"
} finally {
    # Resolve and constrain recursive cleanup to this invocation's temporary directory.
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^proxysplit-core-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
