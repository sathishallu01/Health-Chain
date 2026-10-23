"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const User = require("../models/user");
const HealthRecord = require("../models/healthRecord");
const blockchainService = require("../services/blockchain/blockchainService");
const { seedDemoProviders, SEED_PROVIDERS } = require("../services/seedProviders");

const deploymentPath = path.join(__dirname, "..", "..", "blockchain", "deployments", "contract.json");
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
process.env.GANACHE_ACCOUNT_ADDRESS = deployment.deployerAddress;

async function runAccessControlTests() {
  console.log("==================================================");
  console.log("  ON-CHAIN ACCESS CONTROL INTEGRATION TEST SUITE");
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

  // Connect to DB directly for test setup
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/patient_health_records");
  }

  await seedDemoProviders();
  await blockchainService.init();

  const ts = Date.now();

  // 1. Setup Patient 1 and Patient 2
  const patient1Email = `pat1_access_${ts}@test.invalid`;
  const reg1Res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Patient One", email: patient1Email, password: "Password123!" }),
  });
  assert.strictEqual(reg1Res.status, 201);
  const p1Data = await reg1Res.json();
  const tokenP1 = p1Data.token;
  const userP1 = p1Data.user;

  const patient2Email = `pat2_access_${ts}@test.invalid`;
  const reg2Res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Patient Two", email: patient2Email, password: "Password123!" }),
  });
  assert.strictEqual(reg2Res.status, 201);
  const p2Data = await reg2Res.json();
  const tokenP2 = p2Data.token;
  const userP2 = p2Data.user;

  // 2. Setup Provider A (Dr. Ananya Rao) and Provider B (Dr. Rahul Sharma)
  const providerADoc = await User.findOne({ email: "ananya.rao@citycare.invalid" });
  assert.ok(providerADoc, "Provider A must exist in DB");
  const tokenProviderA = jwt.sign(
    { userId: providerADoc._id.toString(), role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const providerBDoc = await User.findOne({ email: "rahul.sharma@diagnostic.invalid" });
  assert.ok(providerBDoc, "Provider B must exist in DB");
  const tokenProviderB = jwt.sign(
    { userId: providerBDoc._id.toString(), role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 3. Upload a test health record for Patient 1
  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
  const formData = new FormData();
  formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "access_test.pdf");
  formData.append("name", "Cardiology Workup");
  formData.append("type", "Consultation");

  const upRes = await fetch(`${BASE_URL}/api/records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenP1}` },
    body: formData,
  });
  assert.strictEqual(upRes.status, 201);
  const upData = await upRes.json();
  const testRecordId = upData.record._id;

  // ── [SECTION A: LOCAL GANACHE ON-CHAIN INTEGRATION TESTS] ──

  // TEST 1: GET /api/access/providers lists registered providers with initial access = false
  await test("[GANACHE] GET /api/access/providers returns provider list with on-chain status", async () => {
    const res = await fetch(`${BASE_URL}/api/access/providers`, {
      headers: { Authorization: `Bearer ${tokenP1}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.providers));
    assert.ok(data.providers.length >= 3);

    const foundA = data.providers.find((p) => p.id === providerADoc._id.toString());
    assert.ok(foundA);
    assert.strictEqual(foundA.name, "Dr. Ananya Rao");
    assert.strictEqual(foundA.isWalletVerified, true);
  });

  // TEST 2: Unauthorized Provider A cannot view Patient 1's records prior to grant
  await test("[GANACHE] Unauthorized provider receives 403 Forbidden on patient records", async () => {
    const res = await fetch(`${BASE_URL}/api/records/patient/${userP1.id}`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.match(data.message, /not have active on-chain permission/i);
  });

  // TEST 3: Unauthorized Provider A cannot stream Patient 1's file prior to grant
  await test("[GANACHE] Unauthorized provider receives 403 Forbidden on patient record file", async () => {
    const res = await fetch(`${BASE_URL}/api/records/${testRecordId}/file`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // TEST 4: Patient 1 grants access to Provider A on Ganache
  await test("[GANACHE] Patient grants access to Provider A on-chain", async () => {
    const res = await fetch(`${BASE_URL}/api/access/grant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenP1}`,
      },
      body: JSON.stringify({ providerId: providerADoc._id.toString() }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.access, true);
    assert.ok(data.txHash && data.txHash.startsWith("0x"));

    // Verify directly on the smart contract
    const onChainActive = await blockchainService.hasAccess(
      userP1.id,
      providerADoc.ethereumAddress
    );
    assert.strictEqual(onChainActive, true);
  });

  // TEST 5: Authorized Provider A can now retrieve Patient 1's health records
  await test("[GANACHE] Authorized Provider A successfully retrieves patient's records", async () => {
    const res = await fetch(`${BASE_URL}/api/records/patient/${userP1.id}`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.records.length >= 1);
    const rec = data.records.find((r) => r._id === testRecordId);
    assert.ok(rec);
    assert.strictEqual(rec.name, "Cardiology Workup");
    assert.strictEqual(rec.storagePath, undefined, "storagePath must be excluded");
  });

  // TEST 6: Authorized Provider A can stream the protected file
  await test("[GANACHE] Authorized Provider A successfully streams the protected file", async () => {
    const res = await fetch(`${BASE_URL}/api/records/${testRecordId}/file`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 200);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.length > 0);
    assert.strictEqual(buffer.toString("utf8", 0, 5), "%PDF-");
  });

  // TEST 7: Provider B (not granted access) still receives 403 Forbidden
  await test("[GANACHE] Unpermitted Provider B receives 403 Forbidden for Patient 1's records", async () => {
    const res = await fetch(`${BASE_URL}/api/records/patient/${userP1.id}`, {
      headers: { Authorization: `Bearer ${tokenProviderB}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // TEST 8: Cross-patient attempt: Patient 2 tries to modify Patient 1's permissions
  await test("Cross-patient attempt: Patient 2 cannot revoke Patient 1's permissions", async () => {
    // Calling revoke from Patient 2 account only revokes Patient 2's own access
    const res = await fetch(`${BASE_URL}/api/access/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenP2}`,
      },
      body: JSON.stringify({ providerId: providerADoc._id.toString() }),
    });
    assert.strictEqual(res.status, 200);

    // Verify Patient 1's permission on Ganache was NOT affected
    const p1Access = await blockchainService.hasAccess(userP1.id, providerADoc.ethereumAddress);
    assert.strictEqual(p1Access, true, "Patient 1 permission must remain unchanged");
  });

  // TEST 9: Cross-patient read attempt: Patient 2 cannot access Patient 1's records
  await test("Cross-patient attempt: Patient 2 receives 403 reading Patient 1's records", async () => {
    const res = await fetch(`${BASE_URL}/api/records?patientId=${userP1.id}`, {
      headers: { Authorization: `Bearer ${tokenP2}` },
    });
    assert.strictEqual(res.status, 403);
  });

  // TEST 10: Patient 1 revokes access from Provider A on Ganache
  await test("[GANACHE] Patient 1 revokes access from Provider A on-chain", async () => {
    const res = await fetch(`${BASE_URL}/api/access/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenP1}`,
      },
      body: JSON.stringify({ providerId: providerADoc._id.toString() }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.access, false);

    // Verify on-chain status is false
    const onChainActive = await blockchainService.hasAccess(
      userP1.id,
      providerADoc.ethereumAddress
    );
    assert.strictEqual(onChainActive, false);
  });

  // TEST 11: Revoked Provider A receives 403 Forbidden on subsequent requests
  await test("[GANACHE] Revoked Provider A receives 403 Forbidden on subsequent requests", async () => {
    const res = await fetch(`${BASE_URL}/api/records/patient/${userP1.id}`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.match(data.message, /not have active on-chain permission/i);
  });

  // TEST 12: Revoked Provider A receives 403 Forbidden on file download
  await test("[GANACHE] Revoked Provider A receives 403 Forbidden on file streaming", async () => {
    const res = await fetch(`${BASE_URL}/api/records/${testRecordId}/file`, {
      headers: { Authorization: `Bearer ${tokenProviderA}` },
    });
    assert.strictEqual(res.status, 403);
  });

  // ── [SECTION B: WALLET VERIFICATION & ROLE VALIDATION TESTS] ──

  // TEST 13: Rejects granting access to a non-existent provider ID
  await test("Rejects granting access to non-existent provider ID", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${BASE_URL}/api/access/grant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenP1}`,
      },
      body: JSON.stringify({ providerId: fakeId }),
    });
    assert.strictEqual(res.status, 404);
  });

  // TEST 14: Rejects granting access to a user with role 'patient'
  await test("Rejects granting access to a user who is not a healthcare provider", async () => {
    const res = await fetch(`${BASE_URL}/api/access/grant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenP1}`,
      },
      body: JSON.stringify({ providerId: userP2.id }),
    });
    assert.strictEqual(res.status, 404);
  });

  // TEST 15: Cryptographic wallet verification via EIP-191 personal sign
  await test("[MOCKED / CRYPTO] Cryptographic EIP-191 wallet verification validates address ownership", async () => {
    // Generate a fresh temporary testing wallet
    const randomWallet = ethers.Wallet.createRandom();
    const challengeMessage = `HealthChain Wallet Verification: ${providerADoc._id.toString()}:${Date.now()}`;
    const signature = await randomWallet.signMessage(challengeMessage);

    const res = await fetch(`${BASE_URL}/api/access/verify-wallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenProviderA}`,
      },
      body: JSON.stringify({
        message: challengeMessage,
        signature,
        address: randomWallet.address,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.ethereumAddress, randomWallet.address.toLowerCase());
    assert.strictEqual(data.isWalletVerified, true);

    // Restore providerADoc original Ganache address for remaining tests
    await User.findByIdAndUpdate(providerADoc._id, {
      ethereumAddress: providerADoc.ethereumAddress.toLowerCase(),
      isWalletVerified: true,
    });
  });

  // TEST 16: Cryptographic wallet verification rejects forged signature
  await test("[MOCKED / CRYPTO] Rejects wallet verification when signature is forged", async () => {
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    const challengeMessage = `HealthChain Wallet Verification: ${providerADoc._id.toString()}:${Date.now()}`;
    const signatureFromWallet2 = await wallet2.signMessage(challengeMessage);

    // Claim address is wallet1, but signature signed by wallet2
    const res = await fetch(`${BASE_URL}/api/access/verify-wallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenProviderA}`,
      },
      body: JSON.stringify({
        message: challengeMessage,
        signature: signatureFromWallet2,
        address: wallet1.address,
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.match(data.message, /does not match the claimed Ethereum address/i);
  });

  console.log("==================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log("==================================================");

  await mongoose.disconnect();
  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAccessControlTests().catch((err) => {
    console.error("Test runner encountered fatal error:", err);
    process.exit(1);
  });
}

module.exports = runAccessControlTests;
