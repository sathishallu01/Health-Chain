"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const HealthRecord = require("../models/healthRecord");
const { computeFileHash } = require("../utils/hashFile");
const blockchainService = require("../services/blockchain/blockchainService");

const deploymentPath = path.join(__dirname, "..", "..", "blockchain", "deployments", "contract.json");
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
process.env.GANACHE_ACCOUNT_ADDRESS = deployment.deployerAddress;

async function runVerificationTests() {
  console.log("==================================================");
  console.log("  RECORD INTEGRITY VERIFICATION ENDPOINT TESTS");
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

  // Connect to DB directly for test setup/inspection
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/patient_health_records");
  }

  // Ensure blockchain service is initialized
  await blockchainService.init();

  const ts = Date.now();

  // Register Patient A
  const patientAEmail = `patient_a_${ts}@test.invalid`;
  const regARes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Patient A",
      email: patientAEmail,
      password: "Password123!",
    }),
  });
  assert.strictEqual(regARes.status, 201);
  const regAData = await regARes.json();
  const tokenA = regAData.token;
  const userA = regAData.user;

  // Register Patient B
  const patientBEmail = `patient_b_${ts}@test.invalid`;
  const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Patient B",
      email: patientBEmail,
      password: "Password123!",
    }),
  });
  assert.strictEqual(regBRes.status, 201);
  const regBData = await regBRes.json();
  const tokenB = regBData.token;
  const userB = regBData.user;

  // Helper: upload a record for a patient
  async function uploadTestFile(token, fileName, content) {
    const formData = new FormData();
    const blob = new Blob([content], { type: "application/pdf" });
    formData.append("file", blob, fileName);
    formData.append("name", "Test Health Document");
    formData.append("type", "Laboratory");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    return data.record;
  }

  const validPdfHeader = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"
  );

  // 1. Unauthenticated GET /api/records/:id/verify returns 401
  await test("Unauthenticated request returns 401 Unauthorized", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${BASE_URL}/api/records/${fakeId}/verify`);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // 2. Doctor / non-patient role returns 403 Forbidden
  const doctorToken = jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  await test("Non-patient role returns 403 Forbidden", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${BASE_URL}/api/records/${fakeId}/verify`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // 3. Invalid ObjectId format returns 404
  await test("Malformed record ID returns 404 Not Found", async () => {
    const res = await fetch(`${BASE_URL}/api/records/invalid-id-string/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.message, "Record not found.");
  });

  // 4. Record belonging to another patient returns 404 (Requirement 6, 14)
  let recordB;
  await test("Record belonging to another patient returns 404", async () => {
    recordB = await uploadTestFile(tokenB, "patient_b_doc.pdf", validPdfHeader);
    assert.ok(recordB._id);

    // Patient A tries to verify Patient B's record
    const res = await fetch(`${BASE_URL}/api/records/${recordB._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.message, "Record not found.");
  });

  // 5. Unchanged file whose hash is registered on-chain (Requirement 14)
  let recordA1;
  await test("Unchanged file with on-chain registration verifies successfully", async () => {
    recordA1 = await uploadTestFile(tokenA, "patient_a_valid.pdf", validPdfHeader);
    assert.ok(recordA1._id);

    const res = await fetch(`${BASE_URL}/api/records/${recordA1._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.integrityVerified, true);
    assert.strictEqual(data.fileMatchesDatabase, true);
    assert.strictEqual(data.hashRegisteredOnBlockchain, true);
    assert.strictEqual(data.storagePath, undefined, "storagePath must never be exposed");
    assert.match(data.message, /verified successfully/i);
  });

  // 6. Modified file fails verification (Requirement 14)
  await test("Modified file fails fileMatchesDatabase and integrityVerified", async () => {
    const recordA2 = await uploadTestFile(tokenA, "patient_a_tampered.pdf", validPdfHeader);
    assert.ok(recordA2._id);

    // Retrieve storagePath directly from DB to tamper with file
    const dbRecord = await HealthRecord.findById(recordA2._id).select("+storagePath");
    assert.ok(dbRecord.storagePath);
    assert.ok(fs.existsSync(dbRecord.storagePath));

    // Tamper with the file content
    fs.appendFileSync(dbRecord.storagePath, "\nMALICIOUS_TAMPERED_BYTES");

    const res = await fetch(`${BASE_URL}/api/records/${recordA2._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.integrityVerified, false);
    assert.strictEqual(data.fileMatchesDatabase, false);
    assert.strictEqual(data.hashRegisteredOnBlockchain, true);
    assert.strictEqual(data.storagePath, undefined, "storagePath must never be exposed");
    assert.match(data.message, /file content does not match/i);
  });

  // 7. Hash missing from the blockchain (Requirement 14)
  await test("Hash missing from blockchain fails hashRegisteredOnBlockchain and integrityVerified", async () => {
    // Create a local file and record in DB whose hash is NOT sent to blockchain
    const uniquePdfContent = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% Unique offchain ${Date.now()}\ntrailer\n<< >>\n%%EOF\n`
    );
    const uploadsDir = path.join(__dirname, "..", "uploads", userA.id.toString());
    fs.mkdirSync(uploadsDir, { recursive: true });
    const localFilePath = path.join(uploadsDir, `offchain_${Date.now()}.pdf`);
    fs.writeFileSync(localFilePath, uniquePdfContent);

    const fileHash = await computeFileHash(localFilePath);

    const offchainRecord = await HealthRecord.create({
      patient: userA.id,
      name: "Unregistered Health Record",
      type: "Other",
      originalName: "unregistered.pdf",
      mimeType: "application/pdf",
      sizeBytes: uniquePdfContent.length,
      fileHash,
      storagePath: localFilePath,
      blockchainStatus: "pending",
    });

    const res = await fetch(`${BASE_URL}/api/records/${offchainRecord._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.integrityVerified, false);
    assert.strictEqual(data.fileMatchesDatabase, true);
    assert.strictEqual(data.hashRegisteredOnBlockchain, false);
    assert.strictEqual(data.storagePath, undefined, "storagePath must never be exposed");
    assert.match(data.message, /not registered on the blockchain/i);
  });

  // 8. Missing file on disk fails verification safely (Requirement 14)
  await test("Missing file on disk fails gracefully without 500 crash", async () => {
    const recordA3 = await uploadTestFile(tokenA, "patient_a_deleted_file.pdf", validPdfHeader);
    assert.ok(recordA3._id);

    // Retrieve storagePath from DB and delete the physical file
    const dbRecord = await HealthRecord.findById(recordA3._id).select("+storagePath");
    assert.ok(dbRecord.storagePath);
    if (fs.existsSync(dbRecord.storagePath)) {
      fs.unlinkSync(dbRecord.storagePath);
    }
    assert.strictEqual(fs.existsSync(dbRecord.storagePath), false);

    const res = await fetch(`${BASE_URL}/api/records/${recordA3._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.integrityVerified, false);
    assert.strictEqual(data.fileMatchesDatabase, false);
    assert.strictEqual(data.hashRegisteredOnBlockchain, true);
    assert.strictEqual(data.storagePath, undefined, "storagePath must never be exposed");
    assert.match(data.message, /missing or unreadable/i);
  });

  // 9. Synchronize / register off-chain record onto blockchain
  await test("POST /api/records/:id/register registers hash on-chain and restores verified integrity", async () => {
    // Create an unregistered record on disk and DB
    const uniquePdf = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% Sync test ${Date.now()}\ntrailer\n<< >>\n%%EOF\n`
    );
    const uploadsDir = path.join(__dirname, "..", "uploads", userA.id.toString());
    fs.mkdirSync(uploadsDir, { recursive: true });
    const localFilePath = path.join(uploadsDir, `sync_test_${Date.now()}.pdf`);
    fs.writeFileSync(localFilePath, uniquePdf);
    const fileHash = await computeFileHash(localFilePath);

    const offchainRec = await HealthRecord.create({
      patient: userA.id,
      name: "Pending Sync Record",
      type: "Laboratory",
      originalName: "sync_test.pdf",
      mimeType: "application/pdf",
      sizeBytes: uniquePdf.length,
      fileHash,
      storagePath: localFilePath,
      blockchainStatus: "pending",
    });

    // 1. Verify it starts unverified on-chain
    const ver1 = await fetch(`${BASE_URL}/api/records/${offchainRec._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const verData1 = await ver1.json();
    assert.strictEqual(verData1.hashRegisteredOnBlockchain, false);

    // 2. Call register endpoint
    const regRes = await fetch(`${BASE_URL}/api/records/${offchainRec._id}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(regRes.status, 200);
    const regData = await regRes.json();
    assert.strictEqual(regData.success, true);
    assert.strictEqual(regData.blockchainStatus, "verified");
    assert.ok(regData.txHash);

    // 3. Verify it is now verified on-chain
    const ver2 = await fetch(`${BASE_URL}/api/records/${offchainRec._id}/verify`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const verData2 = await ver2.json();
    assert.strictEqual(verData2.integrityVerified, true);
    assert.strictEqual(verData2.hashRegisteredOnBlockchain, true);
    assert.strictEqual(verData2.fileMatchesDatabase, true);
  });

  // 10. Registration security: reject cross-patient and tampered file attempts
  await test("POST /api/records/:id/register rejects unauthorized cross-patient attempts", async () => {
    const recordA = await uploadTestFile(tokenA, "patient_a_sec.pdf", validPdfHeader);

    // Patient B attempts to register Patient A's record
    const crossRes = await fetch(`${BASE_URL}/api/records/${recordA._id}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(crossRes.status, 404);
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
  runVerificationTests().catch((err) => {
    console.error("Test runner encountered fatal error:", err);
    process.exit(1);
  });
}

module.exports = runVerificationTests;
