"use strict";

const assert = require("assert");
const path   = require("path");
const fs     = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const blockchainService = require("../services/blockchain/blockchainService");
const deploymentPath    = path.join(__dirname, "..", "..", "blockchain", "deployments", "contract.json");
const deployment        = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
const CONTRACT_OWNER    = deployment.deployerAddress;

// An account that is valid on Ganache but is NOT the contract owner (Account #1)
const NON_OWNER_GANACHE_ACCOUNT = "0xf897c63d17802c0f54875f4f3913dd353c2473e2";

async function runBlockchainServiceTests() {
  console.log("==================================================");
  console.log("  BLOCKCHAIN SERVICE UNIT & INTEGRATION TESTS");
  console.log("==================================================");
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  const originalEnvAccount = process.env.GANACHE_ACCOUNT_ADDRESS;

  // 1. Missing GANACHE_ACCOUNT_ADDRESS
  await test("Disables writes when GANACHE_ACCOUNT_ADDRESS is missing", async () => {
    delete process.env.GANACHE_ACCOUNT_ADDRESS;
    const available = await blockchainService.init({ force: true });
    assert.strictEqual(available, false);
    assert.strictEqual(blockchainService.isAvailable(), false);
    assert.match(
      blockchainService.unavailableReason(),
      /GANACHE_ACCOUNT_ADDRESS is not set/
    );

    // Calling addRecord must throw
    await assert.rejects(
      async () => {
        await blockchainService.addRecord("test_pat", "a".repeat(64));
      },
      /Blockchain unavailable/
    );
  });

  // 2. Malformed address format
  await test("Rejects malformed GANACHE_ACCOUNT_ADDRESS format", async () => {
    process.env.GANACHE_ACCOUNT_ADDRESS = "invalid-address-string";
    const available = await blockchainService.init({ force: true });
    assert.strictEqual(available, false);
    assert.strictEqual(blockchainService.isAvailable(), false);
    assert.match(
      blockchainService.unavailableReason(),
      /not a valid Ethereum address/
    );
  });

  // 3. Non-owner unlocked account address
  await test("Rejects configured account that is not contract owner", async () => {
    process.env.GANACHE_ACCOUNT_ADDRESS = NON_OWNER_GANACHE_ACCOUNT;
    const available = await blockchainService.init({ force: true });
    assert.strictEqual(available, false);
    assert.strictEqual(blockchainService.isAvailable(), false);
    assert.match(
      blockchainService.unavailableReason(),
      /is not the contract owner/
    );
  });

  // 4. Concurrent initialization safety
  await test("Concurrent init() calls coalesce without race conditions", async () => {
    process.env.GANACHE_ACCOUNT_ADDRESS = CONTRACT_OWNER;
    const promises = [
      blockchainService.init({ force: true }),
      blockchainService.init(),
      blockchainService.init(),
      blockchainService.init(),
    ];
    const results = await Promise.all(promises);
    for (const res of results) {
      assert.strictEqual(res, true);
    }
    assert.strictEqual(blockchainService.isAvailable(), true);
  });

  // 5. Successful connection with contract owner unlocked account
  await test("Connects successfully with contract owner unlocked account", async () => {
    process.env.GANACHE_ACCOUNT_ADDRESS = CONTRACT_OWNER;
    const available = await blockchainService.init({ force: true });
    assert.strictEqual(available, true);
    assert.strictEqual(blockchainService.isAvailable(), true);
    assert.strictEqual(blockchainService.unavailableReason(), "");
  });

  // 6. On-chain addRecord transaction and getRecordHashes
  const testPatientId = `unit_test_pat_${Date.now()}`;
  const testRecordHash = "c0ffee" + "1".repeat(58);

  await test("addRecord writes transaction on-chain via unlocked account", async () => {
    const result = await blockchainService.addRecord(testPatientId, testRecordHash);
    assert.ok(result);
    assert.ok(result.txHash && result.txHash.startsWith("0x"));
    assert.strictEqual(result.txHash.length, 66);
    assert.ok(typeof result.blockNumber === "number" && result.blockNumber > 0);
  });

  await test("getRecordHashes retrieves recorded hash from smart contract", async () => {
    const hashes = await blockchainService.getRecordHashes(testPatientId);
    assert.ok(Array.isArray(hashes));
    assert.strictEqual(hashes.length, 1);
    assert.strictEqual(hashes[0], testRecordHash);
  });

  // 7. On-chain grantAccess and revokeAccess
  const testProvider = "0x0140e191b60cf4ae2419659824c0f952987c4164";

  await test("grantAccess records permission on-chain", async () => {
    const result = await blockchainService.grantAccess(testPatientId, testProvider);
    assert.ok(result);
    assert.ok(result.txHash && result.txHash.startsWith("0x"));
  });

  await test("revokeAccess records revocation on-chain", async () => {
    const result = await blockchainService.revokeAccess(testPatientId, testProvider);
    assert.ok(result);
    assert.ok(result.txHash && result.txHash.startsWith("0x"));
  });

  // 8. End-to-end on-chain audit trail verification
  await test("getAuditEvents returns chronological on-chain event history", async () => {
    const events = await blockchainService.getAuditEvents(testPatientId);
    assert.ok(Array.isArray(events));
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].action, "RecordAdded");
    assert.strictEqual(events[0].args.recordHash, testRecordHash);
    assert.strictEqual(events[1].action, "AccessGranted");
    assert.strictEqual(events[1].args.provider.toLowerCase(), testProvider.toLowerCase());
    assert.strictEqual(events[2].action, "AccessRevoked");
    assert.strictEqual(events[2].args.provider.toLowerCase(), testProvider.toLowerCase());
  });

  // Restore original environment
  if (originalEnvAccount !== undefined) {
    process.env.GANACHE_ACCOUNT_ADDRESS = originalEnvAccount;
  } else {
    delete process.env.GANACHE_ACCOUNT_ADDRESS;
  }

  console.log("==================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runBlockchainServiceTests().catch((err) => {
  console.error("Test runner encountered unexpected error:", err);
  process.exit(1);
});
