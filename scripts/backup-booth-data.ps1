<#
.SYNOPSIS
  Copies a booth's photos and app data to a backup folder (an external drive or a second disk).

.DESCRIPTION
  - Photos: the folder chosen in the app is copied ADDITIVELY into <Destination>\photos. Nothing is ever deleted from the backup,
    so a photo removed on the booth by mistake is still in the backup. Running it every night only copies what is new.
  - App data: the settings, events, rounds and upload history (*.json) go to <Destination>\data\<date-time>, one folder per run.
  - NOT copied on purpose: license-*.json (tied to this PC and secret) and guest-exit-pin.json. On a new PC, activate the licence again.
  - NOT covered: photo TEMPLATES live inside the app window's own storage, not in these files. Use the app's template export for them.

.PARAMETER Destination  Backup folder, e.g. E:\KOKO-backup
.PARAMETER DataDir      The app's data folder. Default: %APPDATA%\koko-photobooth
.PARAMETER KeepRuns     How many dated data folders to keep (default 30). Photos are never pruned.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup-booth-data.ps1 -Destination E:\KOKO-backup
#>
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$DataDir = (Join-Path $env:APPDATA 'koko-photobooth'),
  [int]$KeepRuns = 30
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $DataDir)) { throw "App data folder not found: $DataDir" }

# Which photo folder does the app use?
$photoRoot = $null
$configFile = Join-Path $DataDir 'photo-storage.json'
if (Test-Path -LiteralPath $configFile) { $photoRoot = (Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json).root }
if (-not $photoRoot -or -not (Test-Path -LiteralPath $photoRoot)) { Write-Warning 'No photo folder is configured (or it is missing): only app data will be backed up.'; $photoRoot = $null }

# A backup into the folder being backed up would copy itself forever.
$destFull = [IO.Path]::GetFullPath($Destination)
foreach ($source in @($DataDir, $photoRoot) | Where-Object { $_ }) {
  $srcFull = [IO.Path]::GetFullPath($source).TrimEnd('\') + '\'
  if (($destFull.TrimEnd('\') + '\').StartsWith($srcFull, [StringComparison]::OrdinalIgnoreCase)) { throw "The backup folder must not be inside $source" }
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$result = [ordered]@{ startedAt = (Get-Date).ToString('o'); dataDir = $DataDir; photoRoot = $photoRoot; destination = $destFull }

# 1. App data: whitelist of what the app writes, so tokens and caches are never swept up by accident.
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$dataTarget = Join-Path $Destination "data\$stamp"
New-Item -ItemType Directory -Force -Path $dataTarget | Out-Null
$skip = @('license-device.json', 'license-entitlement.json', 'license-last-observed.json', 'guest-exit-pin.json')
$copied = @()
Get-ChildItem -LiteralPath $DataDir -File -Filter '*.json' | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $dataTarget -Force; $copied += $_.Name
}
if (Test-Path -LiteralPath (Join-Path $DataDir 'fonts')) { Copy-Item -LiteralPath (Join-Path $DataDir 'fonts') -Destination $dataTarget -Recurse -Force; $copied += 'fonts\' }
$result.dataFiles = $copied

# 2. Photos and videos: additive copy (no /MIR, no /PURGE).
if ($photoRoot) {
  $photoTarget = Join-Path $Destination 'photos'
  $log = Join-Path $Destination 'robocopy-last.log'
  robocopy $photoRoot $photoTarget /E /R:1 /W:1 /NP /NDL /NJH /LOG:$log | Out-Null
  # robocopy exit codes 0-7 mean success (bit 8 and up are failures).
  if ($LASTEXITCODE -ge 8) { throw "Copying photos failed (robocopy code $LASTEXITCODE). See $log" }
  $sourceCount = (Get-ChildItem -LiteralPath $photoRoot -Recurse -File | Measure-Object).Count
  $missing = 0
  Get-ChildItem -LiteralPath $photoRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($photoRoot.TrimEnd('\').Length)
    $copy = Join-Path $photoTarget $relative
    if (-not (Test-Path -LiteralPath $copy) -or (Get-Item -LiteralPath $copy).Length -ne $_.Length) { $missing++ }
  }
  $result.photoFiles = $sourceCount; $result.photoFilesMissingOrDifferent = $missing
  if ($missing -gt 0) { throw "$missing of $sourceCount files are missing or different in the backup." }
}

# 3. Keep the newest N dated data folders.
$runs = Get-ChildItem -LiteralPath (Join-Path $Destination 'data') -Directory | Sort-Object Name -Descending
$runs | Select-Object -Skip $KeepRuns | Remove-Item -Recurse -Force
$result.finishedAt = (Get-Date).ToString('o')
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataTarget 'backup-report.json') -Encoding UTF8
Write-Host ("Backup OK: {0} data files, {1} photo/video files verified -> {2}" -f $copied.Count, $result.photoFiles, $destFull)
