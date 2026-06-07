#requires -Version 5.1
<#
.SYNOPSIS
  Minimal smoke check for the delivered sing-box binary.

.DESCRIPTION
  Runs `sing-box version` from the DEV expected path
  (apps/desktop-electron/resources/bin/sing-box.exe), which mirrors
  ProxyClientService.resolveSingBoxPath() in development.

  This does NOT start the proxy, build configs, or connect to any server.
  Exit code 0 means the binary launches and reports its version.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$binPath  = Join-Path $repoRoot 'apps\desktop-electron\resources\bin\sing-box.exe'

if (-not (Test-Path $binPath)) {
  Write-Error "sing-box not found at:`n  $binPath`nRun scripts/windows/fetch-sing-box.ps1 first."
  exit 1
}

Write-Host "Running: `"$binPath`" version"
Write-Host '----------------------------------------'
& $binPath version
$code = $LASTEXITCODE
Write-Host '----------------------------------------'
if ($code -eq 0) {
  Write-Host "OK: sing-box launched successfully (exit 0)."
} else {
  Write-Error "sing-box exited with code $code."
}
exit $code
