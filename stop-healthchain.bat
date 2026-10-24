@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\healthchain-stop.ps1"
if errorlevel 1 (
    echo [ERROR] HealthChain shutdown encountered an error.
    pause
)
endlocal
