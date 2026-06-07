Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host ""
  Write-Host "Alpha dev launcher error:" -ForegroundColor Red
  Write-Host "  $msg" -ForegroundColor Red
  Write-Host ""
  exit 1
}

function HasCmd($name) {
  $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path

Write-Host "Alpha Browser (Windows-native dev)" -ForegroundColor Cyan
Write-Host "Repo: $repo"

if ($repo -like "\\\\wsl$\\*") {
  Write-Host ""
  Write-Host "WARNING: Repo is on \\wsl$ network path." -ForegroundColor Yellow
  Write-Host "This usually breaks native Electron dev (node_modules mismatch, perf, file watching)." -ForegroundColor Yellow
  Write-Host "Recommended: clone/copy repo to Windows FS (e.g. C:\Users\<you>\projects\alpha-browser)." -ForegroundColor Yellow
  Write-Host ""
}

if (-not (HasCmd "node")) { Fail "Node.js not found. Install Node 20+ for Windows." }
if (-not (HasCmd "pnpm")) { Fail "pnpm not found. Install pnpm 9+ (corepack enable or npm i -g pnpm)." }

$nodeVersion = (& node -v) 2>$null
Write-Host "Node: $nodeVersion"

Push-Location $repo
try {
  if (-not (Test-Path (Join-Path $repo "pnpm-lock.yaml"))) {
    Write-Host "Note: pnpm-lock.yaml not found; continuing."
  }

  if (-not (Test-Path (Join-Path $repo "node_modules"))) {
    Write-Host "Installing dependencies (first run)..." -ForegroundColor DarkCyan
    & pnpm install
  }

  Write-Host "Starting desktop dev (native Windows Electron)..." -ForegroundColor DarkCyan
  & pnpm --filter @alpha/desktop-electron dev
}
finally {
  Pop-Location
}

