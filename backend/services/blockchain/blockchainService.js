"use strict";

/**
 * blockchainService.js
 *
 * Thin ethers v6 wrapper around the deployed HealthRecordContract.
 * Loads the contract address and ABI from the deployment artifact produced
 * during Phase 1 (blockchain/deployments/contract.json).
 *
 * Design decisions:
 * ─────────────────
 * • Unlocked account pattern: uses Ganache's unlocked account via
 *   provider.getSigner(accountAddress) configured through GANACHE_ACCOUNT_ADDRESS.
 *   No private keys or mnemonics are stored, required, or handled.
 * • Async and thread-safe initialization: init() is async and coalesces concurrent
 *   initialization requests to prevent race conditions.
 * • Ownership verification: verifies against contract.owner() before enabling
 *   writes so transactions only proceed if the signer is the authorized owner.
 * • Graceful degradation: if GANACHE_ACCOUNT_ADDRESS is missing, or the
 *   deployment artifact does not exist, or ownership verification fails,
 *   isAvailable() returns false and records remain in 'pending' status.
 *
 * Acknowledged limitations (local Ganache demo):
 * ─────────────────────────────────────────────
 * • The backend is the sole contract owner (trusted-oracle pattern).
 * • All transactions are sent with the deployer account; patients have no
 *   independent on-chain identity.
 * • Ganache resets on restart — the deployed contract address and all data
 *   are lost unless state persistence is enabled.
 * • Block timestamps are controlled by the local node and are not production-
 *   grade evidence.
 */

const { ethers } = require("ethers");
const path = require("path");
const fs   = require("fs");

// ── Deployment artifact ──────────────────────────────────────────────────────
// Produced by: npx hardhat run blockchain/scripts/deploy.js --network ganache
const DEPLOYMENT_PATH = path.resolve(
  __dirname,
  "..",   // services/
  "..",   // backend/
  "..",   // project root
  "blockchain",
  "deployments",
  "contract.json"
);

// ── Module-level state ───────────────────────────────────────────────────────
let _initialized       = false;
let _available         = false;
let _unavailableReason = "Blockchain service not yet initialised.";
let _initPromise       = null;
let _initAttempt       = 0;

/** @type {ethers.Contract|null} */
let _contract = null;

/** @type {ethers.JsonRpcProvider|null} */
let _provider = null;

/** @type {ethers.JsonRpcSigner|null} */
let _signer = null;

// ── Initialisation ───────────────────────────────────────────────────────────

/**
 * Attempt to connect to the deployed contract using an unlocked Ganache account.
 * Async and safe against concurrent initialization requests.
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - Re-run initialization even if previously run.
 * @returns {Promise<boolean>} Resolves to true if available, false otherwise.
 */
async function init(options = {}) {
  const force = options && options.force === true;

  if (_initPromise && !force) {
    return _initPromise;
  }

  if (_initialized && !force) {
    return _available;
  }

  if (force) {
    _initialized = false;
    _available   = false;
  }

  const currentAttempt = ++_initAttempt;

  _initPromise = (async () => {
    // Reset availability state for this initialization attempt
    _available = false;
    _contract  = null;
    _provider  = null;
    _signer    = null;

    // 1. Check deployment artifact
    if (!fs.existsSync(DEPLOYMENT_PATH)) {
      _unavailableReason =
        "Deployment artifact not found. Run: " +
        "npx hardhat run blockchain/scripts/deploy.js --network ganache";
      console.warn("[BlockchainService]", _unavailableReason);
      _initialized = true;
      return false;
    }

    // 2. Check unlocked account address from environment
    const accountAddress = process.env.GANACHE_ACCOUNT_ADDRESS
      ? process.env.GANACHE_ACCOUNT_ADDRESS.trim()
      : null;

    if (!accountAddress) {
      _unavailableReason =
        "GANACHE_ACCOUNT_ADDRESS is not set in environment. " +
        "Blockchain writes are disabled — records will stay in 'pending' status.";
      console.warn("[BlockchainService]", _unavailableReason);
      _initialized = true;
      return false;
    }

    // 3. Validate address format
    if (!ethers.isAddress(accountAddress)) {
      _unavailableReason = `Configured GANACHE_ACCOUNT_ADDRESS '${accountAddress}' is not a valid Ethereum address.`;
      console.warn("[BlockchainService]", _unavailableReason);
      _initialized = true;
      return false;
    }

    try {
      const rpcUrl   = process.env.GANACHE_RPC_URL || "http://127.0.0.1:8545";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Obtain signer for the unlocked account from Ganache
      const signer = await provider.getSigner(accountAddress);
      const signerAddress = await signer.getAddress();

      if (signerAddress.toLowerCase() !== accountAddress.toLowerCase()) {
        _unavailableReason =
          `Signer address '${signerAddress}' does not match configured GANACHE_ACCOUNT_ADDRESS '${accountAddress}'.`;
        console.warn("[BlockchainService]", _unavailableReason);
        _initialized = true;
        return false;
      }

      const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
      const contract   = new ethers.Contract(deployment.address, deployment.abi, signer);

      // 4. Verify that the configured signer is the deployed contract owner
      if (typeof contract.owner === "function") {
        const owner = await contract.owner();
        if (currentAttempt !== _initAttempt) return false;
        if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
          _unavailableReason =
            `Configured account '${signerAddress}' is not the contract owner ('${owner}'). ` +
            `Blockchain writes are disabled.`;
          console.warn("[BlockchainService]", _unavailableReason);
          _initialized = true;
          return false;
        }
      }

      if (currentAttempt !== _initAttempt) return false;

      _provider  = provider;
      _signer    = signer;
      _contract  = contract;
      _available = true;
      _unavailableReason = "";

      console.log(
        `[BlockchainService] Connected to HealthRecordContract at ${deployment.address}` +
        ` on ${deployment.network} (${rpcUrl}) using unlocked account ${signerAddress}`
      );
      _initialized = true;
      return true;
    } catch (err) {
      if (currentAttempt !== _initAttempt) return false;
      _unavailableReason = `Blockchain service init failed: ${err.message}`;
      console.warn("[BlockchainService]", _unavailableReason);
      _initialized = true;
      return false;
    } finally {
      if (currentAttempt === _initAttempt) {
        _initPromise = null;
      }
    }
  })();

  return _initPromise;
}

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns true if the service initialised successfully and is available for writes.
 * If initialization has not run yet, starts it in the background.
 *
 * @returns {boolean}
 */
function isAvailable() {
  if (!_initialized && !_initPromise) {
    init().catch(() => {});
  }
  return _available;
}

/**
 * Returns a human-readable reason when isAvailable() === false.
 *
 * @returns {string}
 */
function unavailableReason() {
  return _unavailableReason;
}

// ── Contract interactions ────────────────────────────────────────────────────

/**
 * Register a health-record SHA-256 hash on-chain for the given patient.
 *
 * @param {string} patientId  - MongoDB ObjectId string of the patient.
 * @param {string} recordHash - 64-character hex SHA-256 digest.
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 * @throws  {Error} If the transaction fails or the service is unavailable.
 */
async function addRecord(patientId, recordHash) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }

  const tx      = await _contract.addRecord(patientId, recordHash);
  const receipt = await tx.wait();

  return {
    txHash:      receipt.hash,
    blockNumber: Number(receipt.blockNumber),
  };
}

/**
 * Grant a provider Ethereum address access to a patient's records on-chain.
 *
 * @param {string} patientId       - MongoDB ObjectId string of the patient.
 * @param {string} providerAddress - Ethereum address of the provider wallet.
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 */
async function grantAccess(patientId, providerAddress) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }

  const tx      = await _contract.grantAccess(patientId, providerAddress);
  const receipt = await tx.wait();

  return {
    txHash:      receipt.hash,
    blockNumber: Number(receipt.blockNumber),
  };
}

/**
 * Revoke a provider's on-chain access to a patient's records.
 *
 * @param {string} patientId       - MongoDB ObjectId string of the patient.
 * @param {string} providerAddress - Ethereum address of the provider wallet.
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 */
async function revokeAccess(patientId, providerAddress) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }

  const tx      = await _contract.revokeAccess(patientId, providerAddress);
  const receipt = await tx.wait();

  return {
    txHash:      receipt.hash,
    blockNumber: Number(receipt.blockNumber),
  };
}

/**
 * Retrieve all on-chain audit events for a patient.
 * Returns a merged, chronological list of RecordAdded, AccessGranted, and
 * AccessRevoked events.
 *
 * @param {string} patientId - MongoDB ObjectId string of the patient.
 * @returns {Promise<Array<{action, txHash, blockNumber, timestamp, args}>>}
 */
async function getAuditEvents(patientId) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }

  const [addedEvents, grantedEvents, revokedEvents] = await Promise.all([
    _contract.queryFilter(_contract.filters.RecordAdded(patientId)),
    _contract.queryFilter(_contract.filters.AccessGranted(patientId)),
    _contract.queryFilter(_contract.filters.AccessRevoked(patientId)),
  ]);

  const normalise = (action, events) =>
    events.map((e) => ({
      action,
      txHash:      e.transactionHash,
      blockNumber: Number(e.blockNumber),
      timestamp:   Number(e.args.timestamp),
      args:        {
        ...(e.args.recordHash !== undefined && { recordHash: e.args.recordHash }),
        ...(e.args.provider   !== undefined && { provider: e.args.provider }),
      },
    }));

  const all = [
    ...normalise("RecordAdded",    addedEvents),
    ...normalise("AccessGranted",  grantedEvents),
    ...normalise("AccessRevoked",  revokedEvents),
  ];

  all.sort((a, b) => a.blockNumber - b.blockNumber);
  return all;
}

/**
 * Return on-chain record hashes for a patient (read-only).
 *
 * @param {string} patientId
 * @returns {Promise<string[]>}
 */
async function getRecordHashes(patientId) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }
  return _contract.getRecordHashes(patientId);
}

/**
 * Check if a provider currently has active on-chain access to a patient's records.
 *
 * @param {string} patientId       - MongoDB ObjectId string of the patient.
 * @param {string} providerAddress - Ethereum address of the provider wallet.
 * @returns {Promise<boolean>}
 */
async function hasAccess(patientId, providerAddress) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }
  if (!ethers.isAddress(providerAddress)) {
    throw new Error(`Invalid provider address: ${providerAddress}`);
  }
  return _contract.hasAccess(patientId, providerAddress);
}

/**
 * Return all provider addresses ever granted access for a patient.
 *
 * @param {string} patientId - MongoDB ObjectId string of the patient.
 * @returns {Promise<string[]>}
 */
async function getProviders(patientId) {
  if (!_initialized || _initPromise) {
    await init();
  }
  if (!isAvailable()) {
    throw new Error(`Blockchain unavailable: ${_unavailableReason}`);
  }
  return _contract.getProviders(patientId);
}

// Start background initialisation on module load
init().catch(() => {});

module.exports = {
  init,
  isAvailable,
  unavailableReason,
  addRecord,
  grantAccess,
  revokeAccess,
  hasAccess,
  getProviders,
  getAuditEvents,
  getRecordHashes,
};
