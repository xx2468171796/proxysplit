# Fetch only the reviewed core pinned in bin/core-release.json.
# Two formats:
#   "format": "exe" -> url is the sing-box.exe itself (PowerVPN platform build from the
#                      Gitea generic package gonggong/sing-box); sha256 = the EXE.
#                      "urlAuth": "gitea" sends GITEA_TOKEN (env) as the Authorization header.
#   (default) zip   -> official SagerNet release zip; archiveSha256 + sha256 of the EXE inside.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
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
