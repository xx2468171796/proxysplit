# Read-only diagnostics, with an optional Defender custom scan of the named file.
# Never changes Defender settings, exclusions, or quarantine state.
param(
    [Parameter(Mandatory = $true)][string]$File,
    [string]$Output = '',
    [switch]$Scan
)
$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $File).Path
if (-not $Output) { $Output = $target + '.defender.json' }
$signature = Get-AuthenticodeSignature -LiteralPath $target
$report = [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o')
    file = $target
    sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    authenticodeStatus = [string]$signature.Status
    defenderStatus = $null
    detections = @()
    scan = 'not requested'
    errors = @()
}
try {
    $report.defenderStatus = Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureVersion, AntivirusSignatureLastUpdated
    if ($Scan) {
        Start-MpScan -ScanType CustomScan -ScanPath $target
        $report.scan = 'scan command completed; inspect protection history and detections'
    }
    $report.detections = @(Get-MpThreatDetection | Where-Object {
        @($_.Resources | Where-Object { $_.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    } | Select-Object ThreatID, InitialDetectionTime, LastThreatStatusChangeTime, ActionSuccess, Resources)
    $report.threatNames = @(Get-MpThreat | Select-Object ThreatID, ThreatName, IsActive)
} catch {
    $report.errors += $_.Exception.Message
    if ($Scan) { $report.scan = 'unverified: see errors' }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Host "Diagnostic report: $Output"
if ($report.errors.Count -gt 0) { Write-Warning 'Defender verification is incomplete; absence of detections is not a clean scan.' }
