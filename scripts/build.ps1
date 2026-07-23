# Builds a self-contained, versioned Windows release.
#
# Community/development build:
#   .\scripts\build.ps1 -Version 1.8.0
# Commercial build (login is enforced):
#   .\scripts\build.ps1 -Version 1.8.0 -Commercial `
#     -CommercialAPIURL https://api.example.com `
#     -LicensePublicKeyFile .\secrets\license-public.pem `
#     -TLSSPKISHA256 <sha256-hex>
param(
    [string]$Version = "",
    [switch]$Commercial,
    [switch]$Obfuscate,
    [string]$CommercialAPIURL = "",
    [string]$LicensePublicKeyFile = "",
    [string]$TLSSPKISHA256 = "",
    [string]$SignToolPath = "",
    [string]$SigningThumbprint = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ([string]::IsNullOrWhiteSpace($Version)) {
    $lastTag = (git tag --sort=-version:refname | Select-Object -First 1)
    if ($lastTag -match '^v(\d+)\.(\d+)\.(\d+)$') {
        $Version = '{0}.{1}.{2}' -f $Matches[1], $Matches[2], ([int]$Matches[3] + 1)
    } else { $Version = "0.1.0" }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.8.0 (got '$Version')" }

$ldflags = @('-s', '-w', "-X main.appVersion=$Version")
$commercialEnabled = $Commercial.IsPresent -or -not [string]::IsNullOrWhiteSpace($CommercialAPIURL)
if ($commercialEnabled) {
    if ($CommercialAPIURL -notmatch '^https://') { throw 'CommercialAPIURL must use HTTPS' }
    if (-not (Test-Path -LiteralPath $LicensePublicKeyFile -PathType Leaf)) { throw 'LicensePublicKeyFile is required for a commercial build' }
    $pem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $LicensePublicKeyFile))
    $publicKeyBase64 = ($pem -replace '-----BEGIN PUBLIC KEY-----', '' -replace '-----END PUBLIC KEY-----', '' -replace '\s', '')
    try { $null = [Convert]::FromBase64String($publicKeyBase64) } catch { throw 'LicensePublicKeyFile is not a valid PEM public key' }
    if ($TLSSPKISHA256 -and $TLSSPKISHA256 -notmatch '^([a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$') { throw 'TLSSPKISHA256 must be SHA256 hex or base64' }
    $ldflags += "-X proxysplit/internal/license.APIURL=$CommercialAPIURL"
    $ldflags += "-X proxysplit/internal/license.PublicKeyBase64=$publicKeyBase64"
    if ($TLSSPKISHA256) { $ldflags += "-X proxysplit/internal/license.TLSSPKISHA256=$TLSSPKISHA256" }
    $Obfuscate = $true
}

$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\go\bin;$env:Path"
$env:CGO_ENABLED = "0"
$wails = Join-Path $env:USERPROFILE 'go\bin\wails.exe'
if (-not (Test-Path -LiteralPath $wails)) { $wails = (Get-Command wails -ErrorAction Stop).Source }
$buildArgs = @('build', '-clean', '-trimpath', '-ldflags', ($ldflags -join ' '))
if ($Obfuscate) { $buildArgs += '-obfuscated' }
if ($Obfuscate -and -not (Get-Command garble -ErrorAction SilentlyContinue)) {
    throw 'Garble is required for an obfuscated release. Run: go install mvdan.cc/garble@latest'
}

# Wails temporarily rewrites generated JS bindings to numeric ObfuscatedCall
# dispatchers. Preserve the normal development bindings and restore them after
# the binary/frontend bundle has been compiled.
$bindingBackups = @{}
if ($Obfuscate) {
    foreach ($relative in @('frontend\wailsjs\go\main\App.js', 'frontend\wailsjs\go\main\App.d.ts', 'frontend\wailsjs\go\models.ts')) {
        $path = Join-Path $root $relative
        if (Test-Path -LiteralPath $path) { $bindingBackups[$path] = [IO.File]::ReadAllBytes($path) }
    }
}

Write-Host "==> Wails release build (strip + trimpath; obfuscated=$($Obfuscate.IsPresent))" -ForegroundColor Cyan
try { & $wails @buildArgs }
finally { foreach ($entry in $bindingBackups.GetEnumerator()) { [IO.File]::WriteAllBytes($entry.Key, $entry.Value) } }
if ($LASTEXITCODE -ne 0) { throw 'wails build failed' }

$exe = Join-Path $root 'build\bin\proxysplit.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Build completed without proxysplit.exe' }
$out = Join-Path $root 'output'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$versionedExe = Join-Path $out "proxysplit-v$Version.exe"
Copy-Item -LiteralPath $exe -Destination $versionedExe -Force

if ($SigningThumbprint) {
    if (-not $SignToolPath) { $SignToolPath = (Get-Command signtool.exe -ErrorAction Stop).Source }
    & $SignToolPath sign /sha1 $SigningThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $versionedExe
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed' }
    & $SignToolPath verify /pa $versionedExe
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed' }
}

Copy-Item -LiteralPath $versionedExe -Destination (Join-Path $out 'proxysplit.exe') -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\dist-readme.txt') -Destination (Join-Path $out 'README.txt') -Force
$hash = (Get-FileHash -LiteralPath $versionedExe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    product = 'ProxySplit'; version = $Version; file = (Split-Path -Leaf $versionedExe)
    sha256 = $hash; size = (Get-Item -LiteralPath $versionedExe).Length
    commercial = $commercialEnabled; obfuscated = $Obfuscate.IsPresent
    authenticodeSigned = -not [string]::IsNullOrWhiteSpace($SigningThumbprint)
    builtAt = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out "proxysplit-v$Version.manifest.json") -Encoding utf8

# A successful release supersedes older binaries/manifests, while user data and
# the confirmed UI prototype are deliberately retained.
Get-ChildItem -LiteralPath $out -File | Where-Object {
    $_.Name -match '^proxysplit-v.*\.(exe|manifest\.json)$' -and $_.Name -notin @("proxysplit-v$Version.exe", "proxysplit-v$Version.manifest.json")
} | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
    catch { Write-Warning "Old release is still in use and was retained: $($_.Name)" }
}

$mb = [math]::Round((Get-Item -LiteralPath $versionedExe).Length / 1MB, 1)
Write-Host "==> release: $versionedExe ($mb MB)" -ForegroundColor Green
Write-Host "==> sha256: $hash" -ForegroundColor Green
