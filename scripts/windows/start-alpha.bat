@echo off
setlocal

REM Delegate to repo-root start script, regardless of where clicked from.
cd /d "%~dp0\..\.."
call start-alpha.bat

endlocal

