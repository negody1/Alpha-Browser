@echo off
setlocal

set SCRIPT_DIR=%~dp0
set PS1=%SCRIPT_DIR%alpha-dev.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
  echo.
  echo Alpha dev launcher failed.
  echo.
  pause
  exit /b 1
)

endlocal

