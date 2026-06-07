#requires -Version 5.1
<#
.SYNOPSIS
  Fetches a pinned sing-box release binary, verifies its SHA256, and places
  sing-box.exe into apps/desktop-electron/resources/bin/.

.DESCRIPTION
  The binary is intentionally NOT committed to git (see root .gitignore).
  Run this once per machine, and again after bumping the version in
  scripts/windows/sing-box.manifest.json.

  How to update the pinned version:
    1. Edit "version" in scripts/windows/sing-box.manifest.json.
    2. Clear the matching "sha256" value (set it to "").
    3. Run this script. It downloads the archive, prints the computed SHA256,
       and STOPS without installing (the checksum is not yet pinned).
    4. Confirm the printed hash against the official release page.
    5. Paste the hash into sing-box.manifest.json -> sha256.<target>.
    6. Re-run this script. It now verifies the checksum and installs the binary.

  This script does NOT start the proxy, generate configs, or connect anywhere.
#>
[CmdletBinding()]
param(
  [string]$Target = 'windows-amd64'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir    = $PSScriptRoot
$repoRoot     = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$manifestPath = Join-Path $scriptDir 'sing-box.manifest.json'
$binDir       = Join-Path $repoRoot 'apps\desktop-electron\resources\bin'
$binPath      = Join-Path $binDir 'sing-box.exe'

if (-not (Test-Path $manifestPath)) {
  throw "Manifest not found: $manifestPath"
}

$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$version  = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Manifest 'version' is empty."
}

$expectedSha = ''
if ($manifest.PSObject.Properties.Name -contains 'sha256' -and
    $manifest.sha256.PSObject.Properties.Name -contains $Target) {
  $expectedSha = [string]$manifest.sha256.$Target
}

# Asset naming follows the SagerNet/sing-box release convention.
$assetName   = "sing-box-$version-$Target.zip"
$binaryInZip = "sing-box-$version-$Target/sing-box.exe"
$url         = "https://github.com/SagerNet/sing-box/releases/download/v$version/$assetName"

$tmpDir = Join-Path $env:TEMP "alpha-sing-box-$version"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$zipPath = Join-Path $tmpDir $assetName

Write-Host "sing-box version : $version"
Write-Host "target           : $Target"
Write-Host "downloading      : $url"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

$computed = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "computed SHA256  : $computed"

if ([string]::IsNullOrWhiteSpace($expectedSha)) {
  Write-Warning "No pinned SHA256 for target '$Target' in sing-box.manifest.json."
  Write-Host "Verify the hash above on:"
  Write-Host "  https://github.com/SagerNet/sing-box/releases/tag/v$version"
  Write-Host "Then set sha256.$Target = `"$computed`" in scripts/windows/sing-box.manifest.json and re-run."
  Write-Host "Binary was NOT installed (checksum not pinned)."
  exit 2
}

if ($computed -ne $expectedSha.ToLowerInvariant()) {
  throw ("SHA256 mismatch for $assetName`n" +
         "  expected: $expectedSha`n" +
         "  computed: $computed`n" +
         "Aborting (binary not installed).")
}

$extractDir = Join-Path $tmpDir 'unzipped'
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$srcBinary = Join-Path $extractDir ($binaryInZip -replace '/', '\')
if (-not (Test-Path $srcBinary)) {
  throw "Expected binary not found in archive: $binaryInZip"
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Path $srcBinary -Destination $binPath -Force

Write-Host "installed        : sing-box $version -> $binPath"
Write-Host "Done. Run scripts/windows/verify-sing-box.ps1 to smoke-test."
