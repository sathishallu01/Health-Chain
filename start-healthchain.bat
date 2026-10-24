@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\healthchain-start.ps1"
if errorlevel 1 (
    echo [ERROR] HealthChain startup encountered an error.
    pause
)
endlocal
