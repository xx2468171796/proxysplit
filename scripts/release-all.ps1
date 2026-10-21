# One-command release for the desktop client, API, admin UI and public website.
# Run from any directory:
#   .\scripts\release-all.ps1 -Version 1.9.35 -Title "..." -Summary "..."
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$Title = "",
    [string]$Summary = "",
    [string]$Changelog = "",
    [string]$MinimumVersion = "",
    [ValidateSet('stable', 'beta')]
    [string]$Channel = "stable",
    [switch]$Mandatory,
    [switch]$PreflightOnly,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $root 'build\release-kit\profile.json'
$profile = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json

function Step([string]$text) {
    Write-Host "`n==> $text" -ForegroundColor Cyan
}

function Run([string]$file, [string[]]$arguments, [string]$workingDirectory = $root) {
    Push-Location $workingDirectory
    try {
        # Native tools (pnpm/npm/go) routinely write progress banners to stderr.
        # Under $ErrorActionPreference='Stop', PowerShell 5.1 turns that stderr into
        # a terminating NativeCommandError even on exit code 0. Flatten stderr to
        # plain text and judge success solely by the process exit code.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $file @arguments 2>&1 | ForEach-Object { Write-Host "$_" }
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($code -ne 0) {
            throw "$file failed with exit code $code"
        }
    } finally {
        Pop-Location
    }
}

function Expand-UserPath([string]$path) {
    if ($path.StartsWith('~/') -or $path.StartsWith('~\')) {
        return Join-Path $HOME $path.Substring(2)
    }
    return $path
}

function Read-KeyValueFile([string]$path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') {
            $values[$matches[1].ToUpperInvariant()] = $matches[2]
        }
    }
    return $values
}

function Api([string]$method, [string]$url, $body = $null, [string]$token = '') {
    $headers = @{ Accept = 'application/json' }
    if ($token) { $headers.Authorization = "Bearer $token" }
    $params = @{
        Method = $method
        Uri = $url
        Headers = $headers
        TimeoutSec = 30
    }
    if ($null -ne $body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ($body | ConvertTo-Json -Depth 8)
    }
    return Invoke-RestMethod @params
}

Step 'Release preflight'
foreach ($command in @('git', 'go', 'node', 'npm.cmd', 'pnpm.cmd', 'tar', 'ssh', 'scp')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $command"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts\remote-deploy.sh'))) {
    throw 'Remote deploy script is missing'
}
$dirty = (& git -C $root status --porcelain)
if ($dirty) {
    throw "Git worktree must be clean before a production release:`n$($dirty -join "`n")"
}
$branch = (& git -C $root branch --show-current).Trim()
if ($branch -ne 'main') { throw "Production releases must run from main, current branch: $branch" }
$sourceCommit = (& git -C $root rev-parse HEAD).Trim()

$credentialsPath = Expand-UserPath ([string]$profile.adminCredentialsFile)
if (-not (Test-Path -LiteralPath $credentialsPath -PathType Leaf)) {
    throw "Admin credentials are missing: $credentialsPath"
}
$credentials = Read-KeyValueFile $credentialsPath
foreach ($key in @('USERNAME', 'PASSWORD')) {
    if (-not $credentials.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($credentials[$key])) {
        throw "Admin credentials file has no $key"
    }
}

$baseUrl = ([string]$profile.commercialApiUrl).TrimEnd('/')
$latest = Api 'GET' "$baseUrl/v1/releases/latest?channel=$Channel"
if ($latest.release -and ([version]$Version -le [version]$latest.release.version)) {
    throw "Version $Version must be newer than published $($latest.release.version)"
}
if (-not $Title) { $Title = "ProxySplit v$Version" }
if (-not $Summary) { $Summary = $Title }
if (-not $Changelog) { $Changelog = $Summary }
if (-not $MinimumVersion) { $MinimumVersion = $Version }

Step 'Client and server regression checks'
Run 'go' @('test', './...')
Run 'go' @('vet', './...')
if (-not (Test-Path (Join-Path $root 'frontend\node_modules'))) {
    Run 'pnpm.cmd' @('install', '--frozen-lockfile') (Join-Path $root 'frontend')
}
Run 'pnpm.cmd' @('check') (Join-Path $root 'frontend')
if (-not (Test-Path (Join-Path $root 'server\node_modules'))) {
    Run 'pnpm.cmd' @('install', '--frozen-lockfile') (Join-Path $root 'server')
}
Run 'pnpm.cmd' @('typecheck') (Join-Path $root 'server')
if (-not $SkipTests) {
    Run 'pnpm.cmd' @('test') (Join-Path $root 'server')
}
Run 'pnpm.cmd' @('build') (Join-Path $root 'server')
# 官网（website/，React + dongxiao）：check 里含首屏体积门禁并产出 website/dist。
if (-not (Test-Path (Join-Path $root 'website\node_modules'))) {
    Run 'pnpm.cmd' @('install', '--frozen-lockfile') (Join-Path $root 'website')
}
Run 'pnpm.cmd' @('check') (Join-Path $root 'website')

if ($PreflightOnly) {
    Write-Host "`nPreflight passed. No artifact was built and production was not changed." -ForegroundColor Green
    exit 0
}

Step "Build and sign Windows v$Version"
Run 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'scripts\build-commercial.ps1'), '-Version', $Version)
$exe = Join-Path $root "output\proxysplit-v$Version.exe"
$manifestPath = Join-Path $root "output\proxysplit-v$Version.manifest.json"
if (-not (Test-Path $exe) -or -not (Test-Path $manifestPath)) { throw 'Client artifact is incomplete' }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.version -ne $Version -or $manifest.sourceCommit -ne $sourceCommit -or $manifest.sourceDirty) {
    throw 'Manifest version/source commit does not match the clean release source'
}
$actualHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw 'Client SHA256 verification failed' }

Step 'Assemble immutable server release'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseId = "$stamp-$($sourceCommit.Substring(0, 7))-v$Version"
$temp = Join-Path ([IO.Path]::GetTempPath()) "proxysplit-release-$([guid]::NewGuid().ToString('N'))"
$stage = Join-Path $temp 'server'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
    $sourceTar = Join-Path $temp 'source.tar'
    # -c core.autocrlf=false: `git archive HEAD:server` reads .gitattributes from
    # the server subtree only; without this, a Windows autocrlf=true dev machine
    # would still rewrite shell scripts to CRLF and break Linux container
    # entrypoints (`exec ...: no such file or directory`). Belt-and-suspenders
    # alongside server/.gitattributes.
    Run 'git' @('-c', 'core.autocrlf=false', '-C', $root, 'archive', '--format=tar', '-o', $sourceTar, 'HEAD:server')
    Run 'tar' @('-xf', $sourceTar, '-C', $stage)
    $adminDist = Join-Path $root 'server\apps\admin\dist'
    if (-not (Test-Path (Join-Path $adminDist 'index.html'))) { throw 'Admin dist was not built' }
    Copy-Item -Recurse -Force $adminDist (Join-Path $stage 'apps\admin\dist')
    # nginx 的站点根是 apps/site：放官网构建产物（不带 .vite/ 构建清单）。
    $siteDist = Join-Path $root 'website\dist'
    if (-not (Test-Path (Join-Path $siteDist 'index.html'))) { throw 'Website dist was not built' }
    $siteStage = Join-Path $stage 'apps\site'
    New-Item -ItemType Directory -Path $siteStage -Force | Out-Null
    Get-ChildItem -LiteralPath $siteDist -Force | Where-Object { $_.Name -ne '.vite' } |
        Copy-Item -Destination $siteStage -Recurse -Force
    $archive = Join-Path $temp "proxysplit-server-$releaseId.tar.gz"
    Run 'tar' @('-czf', $archive, '-C', $stage, '.')

    Step "Upload and switch production: $releaseId"
    $sshAlias = [string]$profile.sshAlias
    $productionRoot = [string]$profile.productionRoot
    $remoteIncoming = "$productionRoot/incoming/$releaseId"
    Run 'ssh' @($sshAlias, "mkdir -p '$remoteIncoming'")
    Run 'scp' @($archive, $exe, $manifestPath, (Join-Path $root 'scripts\remote-deploy.sh'), "${sshAlias}:${remoteIncoming}/")
    $remoteArchive = "$remoteIncoming/$([IO.Path]::GetFileName($archive))"
    $remoteExe = "$remoteIncoming/$([IO.Path]::GetFileName($exe))"
    $remoteManifest = "$remoteIncoming/$([IO.Path]::GetFileName($manifestPath))"
    Run 'ssh' @($sshAlias, "chmod 0755 '$remoteIncoming/remote-deploy.sh' && '$remoteIncoming/remote-deploy.sh' '$productionRoot' '$releaseId' '$remoteArchive' '$remoteExe' '$remoteManifest'")
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Step 'Register automatic update release'
$login = Api 'POST' "$baseUrl/v1/auth/login" @{
    username = $credentials.USERNAME
    password = $credentials.PASSWORD
    device = @{
        fingerprint = 'codexreleasepublisher20260724stable'
        name = 'Automated release workflow'
        platform = 'windows'
        appVersion = $Version
    }
}
if (-not $login.accessToken) { throw 'Admin login returned no access token' }
$releaseBody = @{
    version = $Version
    minimumVersion = $MinimumVersion
    url = [string]$manifest.url
    sha256 = [string]$manifest.sha256
    signature = [string]$manifest.signature
    mandatory = [bool]$Mandatory
    title = $Title
    summary = $Summary
    changelog = $Changelog
    channel = $Channel
}
$null = Api 'POST' "$baseUrl/v1/admin/releases" $releaseBody $login.accessToken

Step 'Production acceptance'
$published = Api 'GET' "$baseUrl/v1/releases/latest?channel=$Channel"
if (-not $published.release -or $published.release.version -ne $Version) {
    throw 'Latest release API did not switch to the new version'
}
$download = Invoke-WebRequest -Method Head -UseBasicParsing -Uri "$baseUrl/download/proxysplit-v$Version.exe" -TimeoutSec 30
if ($download.StatusCode -ne 200) { throw 'Versioned download is unavailable' }
$latestDownload = Invoke-WebRequest -Method Head -UseBasicParsing -Uri "$baseUrl/download/proxysplit-latest.exe" -TimeoutSec 30
if ($latestDownload.StatusCode -ne 200) { throw 'Latest download alias is unavailable' }
$health = Api 'GET' "$baseUrl/health"
Write-Host "`nReleased v$Version successfully." -ForegroundColor Green
Write-Host "Commit : $sourceCommit"
Write-Host "SHA256 : $actualHash"
Write-Host "Release: $releaseId"
