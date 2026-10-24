# Blockchain-Based Patient Health Record Management System (HealthChain)

An educational prototype exploring blockchain-based integrity verification and patient-controlled access to health record metadata.

## Technology Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js, Express
- **Database:** MongoDB
- **Smart Contracts:** Solidity, Hardhat
- **Local Blockchain:** Ganache (persistent LevelDB)
- **Blockchain Integration:** ethers.js v6

## Important Notice

This project is for educational demonstration only. Use synthetic data exclusively. Do not upload real patient records or confidential medical information. The prototype is not production-ready and must not be used to manage real medical records.

---

## Daily Startup (One-Click)

To start the entire HealthChain application (Ganache, MongoDB verification, Backend, and Frontend):

1. **Option A (Desktop GUI):** Double-click [`start-healthchain.bat`](start-healthchain.bat) in the project root directory.
2. **Option B (PowerShell / Terminal):**
   ```powershell
   .\start-healthchain.bat
   ```

### What Happens Automatically:
- Checks and starts the local MongoDB Windows service on port `27017` if not already running.
- Launches Ganache CLI on `127.0.0.1:8545` (Chain ID `1337`) with persistent LevelDB storage at `blockchain/ganache-data` and automatically unlocks the contract deployer account (`0x45F96A8ae86d3F4F7d1114Bac1A1fE7a889f05F4`) and seeded provider accounts.
- Validates the smart contract deployment at `0xb353856da6Af64a00aE7AA6Ff93CfEbD7e23345b` on-chain.
- Starts the Express backend on `http://localhost:5000` with health check verification.
- Starts the Vite frontend server on `http://localhost:5173`.
- Opens your default web browser to `http://localhost:5173`.
- Each service runs in its own titled console window for easy live log inspection.
- The startup script is **idempotent**: running it again will not spawn duplicate processes.

---

## Safe Shutdown

To stop all HealthChain services safely without affecting other system processes:

1. **Option A (Desktop GUI):** Double-click [`stop-healthchain.bat`](stop-healthchain.bat).
2. **Option B (PowerShell / Terminal):**
   ```powershell
   .\stop-healthchain.bat
   ```

### What Happens:
- Gracefully terminates only the processes started by HealthChain (tracked in `.pids/` and matched to ports `5173`, `5000`, and `8545`).
- Preserves the shared local MongoDB service and all database records.
- Preserves all on-chain block history, transactions, and LevelDB states.

---

## First-Time Setup

### 1. Prerequisites
- **Node.js** (v18+ recommended) & `npm`
- **MongoDB** Community Server running locally on `mongodb://127.0.0.1:27017`
- **Ganache CLI** (`npm install -g ganache`)

### 2. Dependency Installation
```powershell
# Root & Blockchain
cd C:\projects\patient-health-record\blockchain
npm install

# Backend
cd C:\projects\patient-health-record\backend
npm install

# Frontend
cd C:\projects\patient-health-record\frontend
npm install
```

### 3. Environment Configuration
Ensure `backend/.env` is configured with:
```env
PORT=5000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
MONGO_URI=mongodb://127.0.0.1:27017/patient_health_records
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=1h
MAX_UPLOAD_MB=5
GANACHE_ACCOUNT_ADDRESS=0x45F96A8ae86d3F4F7d1114Bac1A1fE7a889f05F4
GANACHE_RPC_URL=http://127.0.0.1:8545
```

### 4. Verify Initial Setup
Run the automated test suites:
```powershell
cd C:\projects\patient-health-record\backend
npm run test:verify       # Record integrity verification suite
npm run test:blockchain   # Blockchain service integration suite
npm run test:access       # On-chain provider access control suite
npm test                  # Backend Phase 2 test suite

cd C:\projects\patient-health-record\blockchain
npx hardhat test          # Smart contract unit tests (35 passing)

cd C:\projects\patient-health-record\frontend
npm run build             # Frontend production build check
```

---

## Troubleshooting Guide

| Issue | Detection & Cause | Solution |
| :--- | :--- | :--- |
| **MongoDB Connection Failure** | Startup script displays: `[ERROR] MongoDB is not reachable on port 27017.` | Ensure MongoDB Windows service is started by running `net start MongoDB` as Administrator, or start mongod executable manually. |
| **Ganache Connection Failure** | Startup script displays: `[ERROR] Ganache failed to start on port 8545.` | Check if another service is occupying port `8545`. Run `stop-healthchain.bat` to clear stale locks, or inspect `Get-NetTCPConnection -LocalPort 8545`. |
| **Contract Bytecode Mismatch** | Startup script displays: `[ERROR] Contract at 0x... has NO bytecode on the running Ganache chain!` | Ensure Ganache is pointed to `blockchain/ganache-data`. Never wipe or reinitialize `ganache-data` without a backup. |
| **Invalid Account / Writes Disabled** | Backend logs: `Blockchain service init failed: invalid account` | `start-healthchain.bat` automatically unlocks `0x45F96A8ae86d3F4F7d1114Bac1A1fE7a889f05F4` via `--wallet.unlockedAccounts`. Ensure you launch Ganache using `start-healthchain.bat`. |
| **Hash Missing from Blockchain** | Verification returns: `File matches stored hash, Hash missing from blockchain` | In the Patient Portal UI, click the **"Register on Blockchain"** button on the record card to submit the record hash on-chain, or call `POST /api/records/:id/register`. |
| **Computer Restart** | Computer was rebooted or closed. | Run `start-healthchain.bat`. The script re-attaches to the persistent database `ganache-data` with all previously deployed contracts, registered hashes, and granted permissions preserved. No contract redeployment is needed. |

---

## Project Structure

- `start-healthchain.bat` — Single-click automated startup script for Windows
- `stop-healthchain.bat` — Clean shutdown script for all application processes
- `scripts/` — Core automation PowerShell scripts (`healthchain-start.ps1`, `healthchain-stop.ps1`)
- `frontend/` — React application (Vite, Tailwind CSS, Heroicons)
- `backend/` — Express REST API, Mongoose models, and streaming file integrity verification
- `backend/services/blockchain/` — ethers.js v6 abstraction layer connecting Express to Ganache
- `blockchain/contracts/` — Solidity smart contract `HealthRecordContract.sol`
- `blockchain/deployments/` — Contract address and compiled ABI artifacts
- `blockchain/ganache-data/` — Persistent LevelDB blockchain data directory
