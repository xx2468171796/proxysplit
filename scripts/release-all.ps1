# Whole-site release, local half: checks, signed client build and the server
# archive (API source + admin dist + website dist). It never touches production:
# upload / deploy / register go through the baolei bastion (docs/RELEASE-PROCESS.md).
#   .\scripts\release-all.ps1 -Version 1.9.77               # build + stage
#   .\scripts\release-all.ps1 -Version 1.9.77 -PreflightOnly
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
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

Step 'Release preflight'
foreach ($command in @('git', 'go', 'node', 'pnpm.cmd', 'tar')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $command"
    }
}
$dirty = (& git -C $root status --porcelain)
if ($dirty) {
    throw "Git worktree must be clean before a production release:`n$($dirty -join "`n")"
}
$branch = (& git -C $root branch --show-current).Trim()
if ($branch -ne 'main') { throw "Production releases must run from main, current branch: $branch" }
$sourceCommit = (& git -C $root rev-parse HEAD).Trim()

$baseUrl = ([string]$profile.commercialApiUrl).TrimEnd('/')
$latest = Invoke-RestMethod -Uri "$baseUrl/v1/releases/latest?channel=stable" -Headers @{ Accept = 'application/json' } -TimeoutSec 30
if ($latest.release -and ([version]$Version -le [version]$latest.release.version)) {
    throw "Version $Version must be newer than published $($latest.release.version)"
}

Step 'Client and server regression checks'
Run 'go' @('test', './...')
Run 'go' @('vet', './...')
foreach ($dir in @('frontend', 'server', 'website')) {
    if (-not (Test-Path (Join-Path $root "$dir\node_modules"))) {
        Run 'pnpm.cmd' @('install', '--frozen-lockfile') (Join-Path $root $dir)
    }
}
Run 'pnpm.cmd' @('check') (Join-Path $root 'frontend')
Run 'pnpm.cmd' @('typecheck') (Join-Path $root 'server')
if (-not $SkipTests) {
    Run 'pnpm.cmd' @('test') (Join-Path $root 'server')
}
Run 'pnpm.cmd' @('build') (Join-Path $root 'server')
# 官网（website/，React + dongxiao）：check 里含首屏体积门禁并产出 website/dist。
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
$outDir = Join-Path $root "output\release-$releaseId"
$temp = Join-Path ([IO.Path]::GetTempPath()) "proxysplit-release-$([guid]::NewGuid().ToString('N'))"
$stage = Join-Path $temp 'server'
New-Item -ItemType Directory -Path $stage, $outDir -Force | Out-Null
try {
    $sourceTar = Join-Path $temp 'source.tar'
    # -c core.autocrlf=false: `git archive HEAD:server` reads .gitattributes from
    # the server subtree only; without this, a Windows autocrlf=true dev machine
    # would still rewrite shell scripts to CRLF and break Linux container
    # entrypoints (`exec ...: no such file or directory`).
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
    Run 'tar' @('-czf', (Join-Path $outDir "proxysplit-server-$releaseId.tar.gz"), '-C', $stage, '.')
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $exe, $manifestPath, (Join-Path $root 'scripts\remote-deploy.sh') -Destination $outDir

Write-Host "`nStaged v$Version (not deployed)." -ForegroundColor Green
Write-Host "Release id: $releaseId"
Write-Host "Files     : $outDir"
Write-Host "SHA256    : $actualHash"
Write-Host "Next      : upload the four files to sz $($profile.productionRoot)/incoming/$releaseId via the bastion and run remote-deploy.sh (docs/RELEASE-PROCESS.md)."
