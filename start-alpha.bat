@echo off
setlocal EnableExtensions

cd /d "%~dp0"
echo.
echo Starting Alpha Browser (Windows-native dev)...
echo Repo: %cd%
echo.

echo Node:
node -v
echo.

where node >nul 2>nul
if errorlevel 1 goto :fail_node

where corepack >nul 2>nul
if errorlevel 1 goto :fail_corepack_missing

echo Ensuring pnpm via corepack...
call corepack enable
if errorlevel 1 goto :fail_corepack_enable

call corepack prepare pnpm@9.15.0 --activate
if errorlevel 1 goto :fail_corepack_prepare

REM Use pnpm through corepack to avoid PATH shim issues.
call corepack pnpm -v
if errorlevel 1 goto :fail_pnpm

echo.
echo Expected renderer URL: http://127.0.0.1:5173/
echo If you see a white window, check if port 5173 is busy:
echo   netstat -ano ^| findstr :5173
echo.

if exist node_modules goto :run_dev
echo Installing dependencies (first run)...
call corepack pnpm install
if errorlevel 1 goto :fail_install

:run_dev
echo Launching Alpha...
set ALPHA_PROXY_RUNTIME=SING_BOX_REMOTE
echo Proxy runtime: %ALPHA_PROXY_RUNTIME%
call corepack pnpm --filter @alpha/desktop-electron dev

echo.
echo Alpha exited (or crashed). See logs above.
pause
endlocal

goto :eof

:fail_node
echo Node.js not found. Install Node.js 20+ first.
echo https://nodejs.org/
echo.
pause
exit /b 1

:fail_corepack_missing
echo corepack not found. This usually means Node.js is too old or missing Corepack.
echo Install Node.js 20+.
echo.
pause
exit /b 1

:fail_corepack_enable
echo corepack enable failed.
echo.
pause
exit /b 1

:fail_corepack_prepare
echo corepack prepare pnpm failed.
echo.
pause
exit /b 1

:fail_pnpm
echo pnpm is not available via corepack.
echo.
pause
exit /b 1

:fail_install
echo pnpm install failed.
echo.
pause
exit /b 1
