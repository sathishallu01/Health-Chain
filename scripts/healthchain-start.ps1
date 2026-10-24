# HealthChain - Automated Start Script
# Enforces persistent Ganache, contract verification, MongoDB availability, backend, and frontend

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$PidDir      = Join-Path $ProjectRoot ".pids"
$GanacheData = Join-Path $ProjectRoot "blockchain\ganache-data"
$ContractJson = Join-Path $ProjectRoot "blockchain\deployments\contract.json"
$BackendEnv  = Join-Path $ProjectRoot "backend\.env"

if (-not (Test-Path $PidDir)) {
    New-Item -ItemType Directory -Path $PidDir -Force | Out-Null
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host " [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host " [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host " [ERROR] $Message" -ForegroundColor Red
}

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Get-PortProcessId {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Start-ServiceWindow {
    param(
        [string]$Title,
        [string]$Command,
        [string]$WorkDir
    )
    $fullCmd = "cmd.exe /c start `"$Title`" cmd.exe /k `"cd /d `"`"$WorkDir`"`" && $Command`""
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $fullCmd }
    return $res.ProcessId
}

Write-Host "==========================================================" -ForegroundColor Blue
Write-Host "       HealthChain Development Environment Startup        " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Blue

# ── 1. Check MongoDB ────────────────────────────────────────────────────────
Write-Step "Checking MongoDB database service..."
if (Test-PortListening 27017) {
    Write-Success "MongoDB is listening on port 27017."
} else {
    $mongodExe = "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe"
    $mongodCfg = "C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg"
    if ((Test-Path $mongodExe) -and (Test-Path $mongodCfg)) {
        Write-Host "Starting MongoDB process via mongod.exe..." -ForegroundColor Yellow
        Start-Process -FilePath $mongodExe -ArgumentList "--config `"$mongodCfg`"" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    } else {
        try {
            $mongoService = Get-Service -Name "*mongo*" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($mongoService) {
                Start-Service -Name $mongoService.Name -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
        } catch {}
    }
    
    $ready = $false
    for ($i = 0; $i -lt 10; $i++) {
        if (Test-PortListening 27017) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    
    if ($ready) {
        Write-Success "MongoDB started and listening on port 27017."
    } else {
        Write-Fail "MongoDB is not reachable on port 27017."
        Write-Host "Please start MongoDB manually (e.g. 'net start MongoDB') and rerun." -ForegroundColor Yellow
        exit 1
    }
}

# ── 2. Check and Start Ganache ──────────────────────────────────────────────
Write-Step "Checking Ganache blockchain service..."

if (-not (Test-Path $GanacheData)) {
    Write-Fail "Ganache data directory not found at $GanacheData."
    Write-Host "Do not initialize a fresh empty database without reviewing." -ForegroundColor Yellow
    exit 1
}

$ganachePort = 8545
if (Test-PortListening $ganachePort) {
    Write-Success "Ganache is already running on port $ganachePort."
} else {
    $unlockedAccounts = "0x45F96A8ae86d3F4F7d1114Bac1A1fE7a889f05F4 0xf897c63d17802c0f54875f4f3913dd353c2473e2 0xdcfcce8ed470404320e60022cfa6c63f043bd007 0x734c42d658850b32669c0ecd81c750e03547f35f"
    $ganacheCmd = "ganache.cmd --server.host 127.0.0.1 --server.port 8545 --chain.chainId 1337 --database.dbPath `"$GanacheData`" --wallet.unlockedAccounts $unlockedAccounts"
    Start-ServiceWindow -Title "HealthChain - Ganache Blockchain" -Command $ganacheCmd -WorkDir $ProjectRoot | Out-Null

    $ganacheReady = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (Test-PortListening $ganachePort) {
            $ganacheReady = $true
            break
        }
    }

    if (-not $ganacheReady) {
        Write-Fail "Ganache failed to start on port $ganachePort within 15 seconds."
        exit 1
    }
    $actualPid = Get-PortProcessId $ganachePort
    if ($actualPid) {
        Set-Content -Path (Join-Path $PidDir "ganache.pid") -Value $actualPid
    }
    Write-Success "Ganache started successfully on port 8545."
}

# ── 3. Validate Ganache RPC & Chain ID ───────────────────────────────────────
Write-Step "Validating Ganache RPC and Chain ID..."
try {
    $chainPayload = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
    $chainRes = Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method POST -Body $chainPayload -ContentType "application/json" -TimeoutSec 5
    $actualChainId = [Convert]::ToInt32($chainRes.result, 16)
    if ($actualChainId -ne 1337) {
        Write-Fail "Ganache chainId mismatch! Expected 1337, but RPC returned $actualChainId."
        exit 1
    }
    Write-Success "Ganache RPC responsive (Chain ID: 1337)."
} catch {
    Write-Fail "Failed to communicate with Ganache RPC at http://127.0.0.1:8545: $($_.Exception.Message)"
    exit 1
}

# ── 4. Validate Contract Bytecode on Current Chain ──────────────────────────
Write-Step "Validating smart contract deployment on persistent chain..."
if (-not (Test-Path $ContractJson)) {
    Write-Fail "Deployment artifact not found at $ContractJson."
    exit 1
}

$contractData = Get-Content $ContractJson -Raw | ConvertFrom-Json
$contractAddress = $contractData.address
$deployerAddress = $contractData.deployerAddress

if (-not $contractAddress -or -not $deployerAddress) {
    Write-Fail "Invalid contract.json artifact: missing address or deployerAddress."
    exit 1
}

try {
    $codePayload = "{`"jsonrpc`":`"2.0`",`"method`":`"eth_getCode`",`"params`":[`"$contractAddress`",`"latest`"],`"id`":2}"
    $codeRes = Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method POST -Body $codePayload -ContentType "application/json" -TimeoutSec 5
    $code = $codeRes.result
    if (-not $code -or $code -eq "0x" -or $code -eq "0x0") {
        Write-Fail "Contract at $contractAddress has NO bytecode on the running Ganache chain!"
        Write-Host "Ensure Ganache is pointed to '$GanacheData'." -ForegroundColor Yellow
        exit 1
    }
    Write-Success "Contract bytecode verified on-chain at $contractAddress."
    Write-Success "Contract deployer/owner is $deployerAddress."
} catch {
    Write-Fail "Failed to verify contract bytecode: $($_.Exception.Message)"
    exit 1
}

# ── 5. Ensure backend .env has matching GANACHE_ACCOUNT_ADDRESS ──────────────
if (Test-Path $BackendEnv) {
    $envLines = Get-Content $BackendEnv
    $updated = $false
    $newLines = @()
    foreach ($line in $envLines) {
        if ($line -match "^GANACHE_ACCOUNT_ADDRESS=") {
            $currentVal = $line.Split("=")[1].Trim()
            if ($currentVal -ne $deployerAddress) {
                $newLines += "GANACHE_ACCOUNT_ADDRESS=$deployerAddress"
                $updated = $true
            } else {
                $newLines += $line
            }
        } else {
            $newLines += $line
        }
    }
    if ($updated) {
        $newLines | Set-Content $BackendEnv
        Write-Success "Synchronized GANACHE_ACCOUNT_ADDRESS in backend\.env with contract owner."
    }
}

# ── 6. Check and Start Backend ──────────────────────────────────────────────
Write-Step "Checking backend API server..."
$backendPort = 5000
if (Test-PortListening $backendPort) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/health" -TimeoutSec 3
        if ($health.status -eq "ok") {
            Write-Success "Backend is already running on port $backendPort."
        } else {
            Write-Warn "Port $backendPort is open but health check returned unexpected response."
        }
    } catch {
        Write-Warn "Port $backendPort is listening, but health check failed. Reusing process."
    }
} else {
    Write-Host "Starting backend server on port 5000..." -ForegroundColor Yellow
    Start-ServiceWindow -Title "HealthChain - Backend Server" -Command "node server.js" -WorkDir "$ProjectRoot\backend" | Out-Null

    $backendReady = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        if (Test-PortListening $backendPort) {
            try {
                $h = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/health" -TimeoutSec 2
                if ($h.status -eq "ok") { $backendReady = $true; break }
            } catch {}
        }
    }

    if (-not $backendReady) {
        Write-Fail "Backend server failed to respond on http://127.0.0.1:5000/api/health within 25 seconds."
        exit 1
    }
    $actualBackendPid = Get-PortProcessId $backendPort
    if ($actualBackendPid) {
        Set-Content -Path (Join-Path $PidDir "backend.pid") -Value $actualBackendPid
    }
    Write-Success "Backend server running and healthy on http://localhost:5000."
}

# ── 7. Check and Start Frontend ─────────────────────────────────────────────
Write-Step "Checking frontend Vite server..."
$frontendPort = 5173
if (Test-PortListening $frontendPort) {
    Write-Success "Frontend is already running on port $frontendPort."
} else {
    Write-Host "Starting frontend server on port 5173..." -ForegroundColor Yellow
    Start-ServiceWindow -Title "HealthChain - Frontend Web" -Command "npm run dev" -WorkDir "$ProjectRoot\frontend" | Out-Null

    $frontendReady = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (Test-PortListening $frontendPort) {
            $frontendReady = $true
            break
        }
    }

    if (-not $frontendReady) {
        Write-Fail "Frontend server failed to bind to port 5173 within 15 seconds."
        exit 1
    }
    $actualFrontendPid = Get-PortProcessId $frontendPort
    if ($actualFrontendPid) {
        Set-Content -Path (Join-Path $PidDir "frontend.pid") -Value $actualFrontendPid
    }
    Write-Success "Frontend web server running on http://localhost:5173."
}

# ── 8. Open Application in Default Browser ──────────────────────────────────
Write-Step "Opening HealthChain in browser..."
Start-Process "http://localhost:5173"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  HealthChain is UP and RUNNING successfully!             " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Frontend URL     : http://localhost:5173" -ForegroundColor White
Write-Host "  Backend Health   : http://localhost:5000/api/health" -ForegroundColor White
Write-Host "  Ganache RPC      : http://127.0.0.1:8545 (Chain ID: 1337)" -ForegroundColor White
Write-Host "  Smart Contract   : $contractAddress" -ForegroundColor White
Write-Host "  Contract Owner   : $deployerAddress" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "To safely stop all services, run: .\stop-healthchain.bat" -ForegroundColor Yellow
