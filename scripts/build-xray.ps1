# Reproducibly build the Xray-core sidecar pinned in bin/xray-release.json.
#   upstreamTag / upstreamCommit : the upstream XTLS/Xray-core release (commit wins)
#   go                           : Go toolchain used (GOTOOLCHAIN pins it)
# Same flags as upstream's release workflow for windows/amd64:
#   -trimpath -buildvcs=false -gcflags=all=-l=4 -ldflags "-X core.build=<7-char commit> -s -w -buildid="
# Source comes from the Go module proxy by commit (the tag itself is not a
# valid Go module version), so no git clone is needed.
#
# Output: bin\xray.exe + its SHA256. Upload is a separate, manual step (see
# docs/memory/core-update.md「Xray 双内核」):
#   gonggong/generic/xray/<version>/xray-windows-amd64.exe on company Gitea,
#   then write the sha256 into bin/xray-release.json.
param([string]$Out = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'bin\xray-release.json') | ConvertFrom-Json
if (-not $Out) { $Out = Join-Path $root 'bin\xray.exe' }
$commit = $release.upstreamCommit
if (-not $commit -or $commit.Length -ne 40) { throw 'bin/xray-release.json needs the full 40-char upstreamCommit' }

$env:GOTOOLCHAIN = "go$($release.go)"
$ErrorActionPreference = 'Continue'
$info = & go mod download -json "github.com/xtls/xray-core@$commit" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $info.Dir) { throw "Module download failed: $($info.Error)" }
$ErrorActionPreference = 'Stop'

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('proxysplit-xray-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    Copy-Item -Path (Join-Path $info.Dir '*') -Destination $scratch -Recurse
    Get-ChildItem -LiteralPath $scratch -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
    $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:GOFLAGS = '-mod=mod'
    $short = $commit.Substring(0, 7)
    Push-Location $scratch
    $ErrorActionPreference = 'Continue'  # go writes progress to stderr (PowerShell 5.1 would abort)
    try {
        & go build -o $Out -trimpath -buildvcs=false '-gcflags=all=-l=4' "-ldflags=-X github.com/xtls/xray-core/core.build=$short -s -w -buildid=" ./main
        if ($LASTEXITCODE -ne 0) { throw 'xray build failed' }
    } finally { Pop-Location }
    $sha = (Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "Built Xray $($release.version) ($($release.upstreamTag) @ $short) -> $Out"
    Write-Host "sha256 $sha"
    if ($release.sha256 -and $release.sha256 -ne $sha) { Write-Warning "Differs from pinned sha256 $($release.sha256)" }
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^proxysplit-xray-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
