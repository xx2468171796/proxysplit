# Builds a self-contained, versioned Windows release.
#
# Community/development build:
#   .\scripts\build.ps1 -Version 1.8.0
# Commercial build (login is enforced):
#   .\scripts\build.ps1 -Version 1.8.0 -Commercial `
#     -CommercialAPIURL https://api.example.com `
#     -LicensePublicKeyFile .\secrets\license-public.pem `
#     -ReleasePublicKeyFile .\secrets\release-public.pem `
#     -ReleaseSigningPrivateKeyFile .\secrets\release-private.pem `
#     -DownloadBaseURL https://api.example.com/download `
#     -TLSSPKISHA256 <sha256-hex>
param(
    [string]$Version = "",
    [switch]$Commercial,
    [switch]$Obfuscate,
    [string]$CommercialAPIURL = "",
    [string]$LicensePublicKeyFile = "",
    [string]$ReleasePublicKeyFile = "",
    [string]$ReleaseSigningPrivateKeyFile = "",
    [string]$DownloadBaseURL = "",
    [string]$TLSSPKISHA256 = "",
    [string]$SignToolPath = "",
    [string]$SigningThumbprint = "",
    # POWER云 panel Ed25519 client-signing public key (raw 32 bytes, base64url). Empty = no
    # official profiles (every subscription stays in compat mode).
    [string]$PanelPublicKey = "",
    [switch]$AllowDirty
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
if ($PanelPublicKey) {
    if ($PanelPublicKey -notmatch '^[A-Za-z0-9_-]{43}=?$') { throw 'PanelPublicKey must be a base64url raw Ed25519 key' }
    $ldflags += "-X proxysplit/internal/powervpn.PanelPublicKey=$PanelPublicKey"
}
$commercialEnabled = $Commercial.IsPresent -or -not [string]::IsNullOrWhiteSpace($CommercialAPIURL)
$obfuscateEnabled = $Obfuscate.IsPresent
$sourceCommit = (git rev-parse HEAD).Trim()
$sourceDirty = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
if ($commercialEnabled -and $sourceDirty -and -not $AllowDirty.IsPresent) {
    throw 'Commercial releases require a clean Git worktree so the EXE can be mapped to one exact commit. Commit changes first, or explicitly use -AllowDirty for a non-publishable diagnostic build.'
}
if ($commercialEnabled) {
    if ($CommercialAPIURL -notmatch '^https://') { throw 'CommercialAPIURL must use HTTPS' }
    if (-not (Test-Path -LiteralPath $LicensePublicKeyFile -PathType Leaf)) { throw 'LicensePublicKeyFile is required for a commercial build' }
    if ([string]::IsNullOrWhiteSpace($TLSSPKISHA256)) { throw 'TLSSPKISHA256 is required for a commercial build (fail-closed TLS pinning)' }
    if (-not (Test-Path -LiteralPath $ReleasePublicKeyFile -PathType Leaf)) { throw 'ReleasePublicKeyFile is required for signed automatic updates' }
    if (-not (Test-Path -LiteralPath $ReleaseSigningPrivateKeyFile -PathType Leaf)) { throw 'ReleaseSigningPrivateKeyFile is required for a commercial release' }
    $pem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $LicensePublicKeyFile))
    $publicKeyBase64 = ($pem -replace '-----BEGIN PUBLIC KEY-----', '' -replace '-----END PUBLIC KEY-----', '' -replace '\s', '')
    try { $null = [Convert]::FromBase64String($publicKeyBase64) } catch { throw 'LicensePublicKeyFile is not a valid PEM public key' }
    if ($TLSSPKISHA256 -and $TLSSPKISHA256 -notmatch '^([a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$') { throw 'TLSSPKISHA256 must be SHA256 hex or base64' }
    $ldflags += "-X proxysplit/internal/license.APIURL=$CommercialAPIURL"
    $ldflags += "-X proxysplit/internal/license.PublicKeyBase64=$publicKeyBase64"
    if ($TLSSPKISHA256) { $ldflags += "-X proxysplit/internal/license.TLSSPKISHA256=$TLSSPKISHA256" }
    if ($ReleasePublicKeyFile) {
        $releasePem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ReleasePublicKeyFile))
        $releasePublicKeyBase64 = ($releasePem -replace '-----BEGIN PUBLIC KEY-----', '' -replace '-----END PUBLIC KEY-----', '' -replace '\s', '')
        try { $null = [Convert]::FromBase64String($releasePublicKeyBase64) } catch { throw 'ReleasePublicKeyFile is not a valid PEM public key' }
        $ldflags += "-X main.updateAPIURL=$CommercialAPIURL"
        $ldflags += "-X main.updatePublicKeyBase64=$releasePublicKeyBase64"
        if ($TLSSPKISHA256) { $ldflags += "-X main.updateTLSSPKISHA256=$TLSSPKISHA256" }
    }
    if ($ReleaseSigningPrivateKeyFile -and -not $ReleasePublicKeyFile) { throw 'ReleasePublicKeyFile is required when signing releases' }
}

# Every build must embed the reviewed upstream core, never an untracked stale
# download. Fetch the pinned release first if setting up a fresh checkout.
$coreRelease = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'bin\core-release.json') | ConvertFrom-Json
$coreExe = Join-Path $root 'bin\sing-box.exe'
if (-not (Test-Path -LiteralPath $coreExe)) { throw 'Missing core: run scripts\fetch-core.ps1 first' }
$coreHash = (Get-FileHash -LiteralPath $coreExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($coreHash -ne $coreRelease.sha256) { throw 'Bundled core does not match bin/core-release.json; run scripts\fetch-core.ps1' }
# Xray sidecar (XHTTP / mKCP / VLESS encryption nodes): bundled when present;
# a wrong file is fatal, a missing one only means lazy download on first need.
$xrayRelease = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'bin\xray-release.json') | ConvertFrom-Json
$xrayExe = Join-Path $root 'bin\xray.exe'
if (Test-Path -LiteralPath $xrayExe) {
    if ((Get-FileHash -LiteralPath $xrayExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $xrayRelease.sha256) { throw 'bin\xray.exe does not match bin/xray-release.json; run scripts\fetch-core.ps1' }
} else { Write-Warning 'bin\xray.exe missing: this build will NOT bundle Xray (run scripts\fetch-core.ps1 -RequireXray for releases)' }

$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\go\bin;$env:Path"
$env:CGO_ENABLED = "0"
$wails = Join-Path $env:USERPROFILE 'go\bin\wails.exe'
if (-not (Test-Path -LiteralPath $wails)) { $wails = (Get-Command wails -ErrorAction Stop).Source }
$buildArgs = @('build', '-clean', '-trimpath', '-ldflags', ($ldflags -join ' '))
if ($obfuscateEnabled) { $buildArgs += '-obfuscated' }
if ($obfuscateEnabled -and -not (Get-Command garble -ErrorAction SilentlyContinue)) {
    throw 'Garble is required for an obfuscated release. Run: go install mvdan.cc/garble@latest'
}

# Wails temporarily rewrites generated JS bindings to numeric ObfuscatedCall
# dispatchers. Preserve the normal development bindings and restore them after
# the binary/frontend bundle has been compiled.
$bindingBackups = @{}
$wailsConfigPath = Join-Path $root 'wails.json'
$wailsConfigBackup = [IO.File]::ReadAllBytes($wailsConfigPath)
$distGitkeepPath = Join-Path $root 'frontend\dist\gitkeep'
$distGitkeepBackup = if (Test-Path -LiteralPath $distGitkeepPath) {
    [IO.File]::ReadAllBytes($distGitkeepPath)
} else {
    $null
}
if ($obfuscateEnabled) {
    foreach ($relative in @('frontend\wailsjs\go\main\App.js', 'frontend\wailsjs\go\main\App.d.ts', 'frontend\wailsjs\go\models.ts')) {
        $path = Join-Path $root $relative
        if (Test-Path -LiteralPath $path) { $bindingBackups[$path] = [IO.File]::ReadAllBytes($path) }
    }
}

# Wails takes the Windows FileVersion/ProductVersion resource from
# wails.json -> info.productVersion, independently from Go ldflags. Set it to
# the same release version for the duration of the build, then restore the
# repository file byte-for-byte.
$wailsConfig = [IO.File]::ReadAllText($wailsConfigPath) | ConvertFrom-Json
if (-not $wailsConfig.info) {
    $wailsConfig | Add-Member -NotePropertyName info -NotePropertyValue ([pscustomobject]@{})
}
$wailsConfig.info | Add-Member -NotePropertyName companyName -NotePropertyValue 'ProxySplit' -Force
$wailsConfig.info | Add-Member -NotePropertyName productName -NotePropertyValue 'ProxySplit' -Force
$wailsConfig.info | Add-Member -NotePropertyName productVersion -NotePropertyValue $Version -Force
$wailsConfig.info | Add-Member -NotePropertyName copyright -NotePropertyValue 'Copyright © ProxySplit' -Force
$wailsConfig.info | Add-Member -NotePropertyName comments -NotePropertyValue "ProxySplit v$Version ($sourceCommit)" -Force
[IO.File]::WriteAllText($wailsConfigPath, ($wailsConfig | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

Write-Host "==> Wails release build (strip + trimpath; obfuscated=$obfuscateEnabled)" -ForegroundColor Cyan
try { & $wails @buildArgs }
finally {
    [IO.File]::WriteAllBytes($wailsConfigPath, $wailsConfigBackup)
    if ($null -ne $distGitkeepBackup) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $distGitkeepPath) | Out-Null
        [IO.File]::WriteAllBytes($distGitkeepPath, $distGitkeepBackup)
    }
    foreach ($entry in $bindingBackups.GetEnumerator()) { [IO.File]::WriteAllBytes($entry.Key, $entry.Value) }
}
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
$downloadURL = ""
$releaseSignature = ""
if ($ReleaseSigningPrivateKeyFile) {
    if (-not (Test-Path -LiteralPath $ReleaseSigningPrivateKeyFile -PathType Leaf)) { throw 'ReleaseSigningPrivateKeyFile does not exist' }
    if ([string]::IsNullOrWhiteSpace($DownloadBaseURL)) { $DownloadBaseURL = "$CommercialAPIURL/download" }
    if ($DownloadBaseURL -notmatch '^https://') { throw 'DownloadBaseURL must use HTTPS' }
    $downloadURL = "$($DownloadBaseURL.TrimEnd('/'))/proxysplit-v$Version.exe"
    $releaseSignature = (& go run ./cmd/releasesign --private-key $ReleaseSigningPrivateKeyFile --version $Version --sha256 $hash --url $downloadURL)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseSignature)) { throw 'release signing failed' }
}
$manifest = [ordered]@{
    product = 'ProxySplit'; version = $Version; file = (Split-Path -Leaf $versionedExe)
    sha256 = $hash; size = (Get-Item -LiteralPath $versionedExe).Length
    url = $downloadURL; signature = $releaseSignature
    commercial = $commercialEnabled; obfuscated = $obfuscateEnabled
    authenticodeSigned = -not [string]::IsNullOrWhiteSpace($SigningThumbprint)
    windowsProductVersion = $Version
    coreVersion = $coreRelease.version
    coreSha256 = $coreHash
    sourceCommit = $sourceCommit
    sourceDirty = $sourceDirty
    builtAt = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out "proxysplit-v$Version.manifest.json") -Encoding utf8

# Keep prior versioned artifacts for rollback and false-positive comparisons.

$mb = [math]::Round((Get-Item -LiteralPath $versionedExe).Length / 1MB, 1)
Write-Host "==> release: $versionedExe ($mb MB)" -ForegroundColor Green
Write-Host "==> sha256: $hash" -ForegroundColor Green
