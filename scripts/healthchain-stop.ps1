# HealthChain - Automated Safe Shutdown Script
# Stops only frontend, backend, and Ganache without killing unrelated processes

$ErrorActionPreference = "Continue"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$PidDir      = Join-Path $ProjectRoot ".pids"

function Stop-SpecificProcess {
    param(
        [string]$Name,
        [string]$PidFileName,
        [int]$Port,
        [string]$ProcessPattern
    )

    $stopped = $false

    # 1. Try PID file
    $pidFile = Join-Path $PidDir $PidFileName
    if (Test-Path $pidFile) {
        $trackedProcId = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
        if ($trackedProcId -match "^\d+$") {
            $proc = Get-Process -Id ([int]$trackedProcId) -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Stopping $Name by tracked PID $trackedProcId..." -ForegroundColor Yellow
                Stop-Process -Id ([int]$trackedProcId) -Force -ErrorAction SilentlyContinue
                # Also kill child processes if any
                Get-CimInstance Win32_Process -Filter "ParentProcessId = $trackedProcId" -ErrorAction SilentlyContinue |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                $stopped = $true
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    # 2. Check process listening on port if not already stopped
    if ($Port -gt 0) {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn -and $conn.OwningProcess -gt 0) {
            $targetPid = $conn.OwningProcess
            $winProc = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction SilentlyContinue
            if ($winProc -and ($winProc.CommandLine -match $ProcessPattern)) {
                Write-Host "Stopping $Name listening on port $Port (PID $targetPid)..." -ForegroundColor Yellow
                Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
                $stopped = $true
            }
        }
    }

    if ($stopped) {
        Write-Host " [OK] $Name stopped." -ForegroundColor Green
    } else {
        Write-Host " [INFO] $Name was not running." -ForegroundColor Cyan
    }
}

Write-Host "==========================================================" -ForegroundColor Blue
Write-Host "       HealthChain Development Environment Shutdown        " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Blue

Stop-SpecificProcess -Name "Frontend (Vite)" -PidFileName "frontend.pid" -Port 5173 -ProcessPattern "vite|frontend"
Stop-SpecificProcess -Name "Backend API"      -PidFileName "backend.pid"  -Port 5000 -ProcessPattern "server\.js|backend"
Stop-SpecificProcess -Name "Ganache Node"     -PidFileName "ganache.pid"  -Port 8545 -ProcessPattern "ganache"

Write-Host "`nShared MongoDB service left running (system service)." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Blue
Write-Host "All HealthChain application components stopped safely." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Blue
