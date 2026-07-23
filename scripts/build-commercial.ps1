# One-command production release wrapper. All non-secret production build
# inputs are versioned under build/release-kit. The release signing private key
# remains local and is integrity-checked before use.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $root 'build\release-kit\profile.json'
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
    throw "Release profile is missing: $profilePath"
}

$profile = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
function Resolve-RepoFile([string]$relative, [string]$label) {
    $path = Join-Path $root ($relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "$label is missing: $path"
    }
    return (Resolve-Path -LiteralPath $path).Path
}

$licensePublicKey = Resolve-RepoFile $profile.licensePublicKey 'License public key'
$releasePublicKey = Resolve-RepoFile $profile.releasePublicKey 'Release public key'
$tlsSpkiFile = Resolve-RepoFile $profile.tlsSpkiFile 'TLS SPKI file'
$releasePrivateKey = Resolve-RepoFile $profile.localReleasePrivateKey 'Local release signing private key'

$privateKeyHash = (Get-FileHash -LiteralPath $releasePrivateKey -Algorithm SHA256).Hash.ToLowerInvariant()
if ($privateKeyHash -ne [string]$profile.releasePrivateKeySha256) {
    throw "Local release signing private key integrity check failed (SHA256 mismatch)"
}

$tlsSpki = (Get-Content -Raw -LiteralPath $tlsSpkiFile).Trim()
if ($tlsSpki -notmatch '^([a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$') {
    throw 'TLS SPKI profile value is invalid'
}

$requiredCommands = @('go', 'node', 'npm', 'git')
foreach ($name in $requiredCommands) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required build command is unavailable: $name"
    }
}
$wails = Join-Path $env:USERPROFILE 'go\bin\wails.exe'
if (-not (Test-Path -LiteralPath $wails) -and -not (Get-Command wails -ErrorAction SilentlyContinue)) {
    throw 'Wails CLI is unavailable'
}
if (-not (Get-Command garble -ErrorAction SilentlyContinue)) {
    throw 'Garble is unavailable. Run: go install mvdan.cc/garble@latest'
}

Write-Host "Production profile: $($profile.name)" -ForegroundColor Cyan
Write-Host "Version: v$Version" -ForegroundColor Cyan
Write-Host "API: $($profile.commercialApiUrl)" -ForegroundColor Cyan
Write-Host "Download: $($profile.downloadBaseUrl)" -ForegroundColor Cyan
Write-Host "Public keys, TLS pin and local signing key: OK" -ForegroundColor Green

if ($CheckOnly) {
    Write-Host 'Release build preflight passed.' -ForegroundColor Green
    exit 0
}

& (Join-Path $root 'scripts\build.ps1') `
    -Version $Version `
    -Commercial `
    -CommercialAPIURL $profile.commercialApiUrl `
    -LicensePublicKeyFile $licensePublicKey `
    -ReleasePublicKeyFile $releasePublicKey `
    -ReleaseSigningPrivateKeyFile $releasePrivateKey `
    -TLSSPKISHA256 $tlsSpki `
    -DownloadBaseURL $profile.downloadBaseUrl

if ($LASTEXITCODE -ne 0) {
    throw "Production release build failed with exit code $LASTEXITCODE"
}
