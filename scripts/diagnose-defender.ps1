# Evidence collection works even after the executable has been quarantined.
# Does not change protection, exclusions, or quarantine state.
param(
    [string]$File = '',
    [string]$Output = '',
    [switch]$Scan,
    [ValidateRange(1, 90)][int]$Days = 14
)
$ErrorActionPreference = 'Stop'
$target = if ($File) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($File) } else { '' }
if (-not $Output) { $Output = Join-Path (Get-Location) ('proxysplit-defender-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json') }
$report = [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o')
    file = $target
    fileExists = $false
    sha256 = $null
    authenticodeStatus = $null
    fileVersion = $null
    defenderStatus = $null
    detections = @()
    threatNames = @()
    events = @()
    scan = 'not requested'
    verification = 'unverified; this report alone is not a clean scan verdict'
    errors = @()
}
function Record-Failure([string]$stage, $failure) {
    $report.errors += [pscustomobject]@{ stage = $stage; message = $failure.Exception.Message }
}
function Matches-Target([string]$resource) {
    if (-not $resource) { return $false }
    if ($target) { return $resource.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
    return $resource -match '(?i)proxysplit|sing-box'
}
if ($target) {
    $report.fileExists = Test-Path -LiteralPath $target -PathType Leaf
    if ($report.fileExists) {
        try {
            $report.sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
            $report.authenticodeStatus = [string](Get-AuthenticodeSignature -LiteralPath $target).Status
            $report.fileVersion = (Get-Item -LiteralPath $target).VersionInfo.FileVersion
        } catch { Record-Failure 'file inspection' $_ }
    }
}
try {
    $report.defenderStatus = Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureVersion, AntivirusSignatureLastUpdated
} catch { Record-Failure 'Defender status' $_ }
if ($Scan) {
    if (-not $report.fileExists) {
        $report.scan = 'not run: target file absent; collecting detection history instead'
    } else {
        try {
            Start-MpScan -ScanType CustomScan -ScanPath $target
            $report.scan = 'scan command completed; inspect detections and protection history'
        } catch {
            $report.scan = 'unverified: scan failed'
            Record-Failure 'Defender scan' $_
        }
    }
}
# Query each source independently: one unavailable cmdlet must not hide logs.
try {
    $report.detections = @(Get-MpThreatDetection | Where-Object {
        @($_.Resources | Where-Object { Matches-Target ([string]$_) }).Count -gt 0
    } | Select-Object ThreatID, InitialDetectionTime, LastThreatStatusChangeTime, ActionSuccess, Resources)
} catch { Record-Failure 'Defender detection history' $_ }
try {
    $ids = @($report.detections | ForEach-Object { $_.ThreatID })
    $report.threatNames = @(Get-MpThreat | Where-Object { $_.ThreatID -in $ids } | Select-Object ThreatID, ThreatName, IsActive)
} catch { Record-Failure 'Defender threat names' $_ }
try {
    $events = Get-WinEvent -FilterHashtable @{
        LogName = 'Microsoft-Windows-Windows Defender/Operational'
        Id = 1116, 1117, 1118, 1119
        StartTime = (Get-Date).AddDays(-$Days)
    } -MaxEvents 1000 -ErrorAction Stop
    $report.events = @($events | ForEach-Object {
        [xml]$xml = $_.ToXml()
        $data = [ordered]@{}
        foreach ($field in $xml.Event.EventData.Data) { $data[[string]$field.Name] = [string]$field.'#text' }
        if (Matches-Target (($data.Values | ForEach-Object { [string]$_ }) -join "`n")) {
            [pscustomobject]@{ time = $_.TimeCreated; eventId = $_.Id; data = $data }
        }
    })
} catch { Record-Failure 'Defender event log' $_ }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Host "Diagnostic report: $Output"
if (-not $report.fileExists -and $target) { Write-Host 'File is absent; detection history was still queried.' }
if ($report.errors.Count -gt 0) { Write-Warning 'Evidence collection is incomplete. Missing detections do not establish that the file is safe.' }