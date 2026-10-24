"use strict";

require("dotenv").config({ path: "backend/.env" });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const HealthRecord = require("../models/healthRecord");
const blockchainService = require("../services/blockchain/blockchainService");

const API_BASE = "http://127.0.0.1:5000";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    testsFailed++;
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  testsPassed++;
  console.log(`  ✓ PASS: ${message}`);
}

async function runTests() {
  console.log("==================================================");
  console.log("  DOCTOR DASHBOARD & ROLE-BASED ACCESS CONTROL TESTS");
  console.log("==================================================");

  await mongoose.connect(process.env.MONGO_URI);
  await blockchainService.init();

  // Find seeded users
  const patient = await User.findOne({ email: /satya/i });
  const doctorRahul = await User.findOne({ email: /rahul.sharma/i });
  const doctorAnanya = await User.findOne({ email: /ananya.rao/i });
  const record = await HealthRecord.findOne({ patient: patient._id, isDeleted: false });

  // 1. Patient registration and login returns role: 'patient'
  const ts = Date.now();
  const testPatientEmail = `test_pat_${ts}@test.invalid`;
  await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Demo Patient", email: testPatientEmail, password: "Password123!" }),
  });

  const patientLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testPatientEmail, password: "Password123!" }),
  });
  const patientLoginData = await patientLoginRes.json();
  assert(
    patientLoginRes.status === 200 && patientLoginData.user.role === "patient",
    "1. Patient login returns role: 'patient' for Patient Dashboard rendering"
  );

  const satyaToken = jwt.sign(
    { userId: patient._id.toString(), role: "patient" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 2. Doctor login returns role: 'doctor'
  const doctorLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: doctorRahul.email, password: "Password123!" }),
  });
  const doctorLoginData = await doctorLoginRes.json();
  assert(
    doctorLoginRes.status === 200 && doctorLoginData.user.role === "doctor",
    "2. Doctor login returns role: 'doctor' for Doctor Dashboard rendering"
  );

  // 3. Invalid doctor credentials are rejected with 401
  const badLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: doctorRahul.email, password: "WrongPassword!" }),
  });
  assert(
    badLoginRes.status === 401,
    "3. Invalid doctor credentials return HTTP 401 Unauthorized"
  );

  // 4. Authorized doctor (Dr. Rahul) can view permitted records
  const rahulRecordsRes = await fetch(`${API_BASE}/api/records/patient/${patient._id}`, {
    headers: { Authorization: `Bearer ${doctorLoginData.token}` },
  });
  const rahulRecordsData = await rahulRecordsRes.json();
  assert(
    rahulRecordsRes.status === 200 && rahulRecordsData.count > 0,
    "4. Authorized doctor (Dr. Rahul) successfully retrieves patient records"
  );

  // 5. Authorized doctor can download/stream the file
  const rahulFileRes = await fetch(`${API_BASE}/api/records/${record._id}/file`, {
    headers: { Authorization: `Bearer ${doctorLoginData.token}` },
  });
  assert(
    rahulFileRes.status === 200 && rahulFileRes.headers.get("content-type"),
    "5. Authorized doctor (Dr. Rahul) successfully downloads protected record file"
  );

  // 6. Unauthorized / Revoked doctor (Dr. Ananya) receives 403 on records
  const ananyaToken = jwt.sign(
    { userId: doctorAnanya._id.toString(), role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  const ananyaRecordsRes = await fetch(`${API_BASE}/api/records/patient/${patient._id}`, {
    headers: { Authorization: `Bearer ${ananyaToken}` },
  });
  assert(
    ananyaRecordsRes.status === 403,
    "6. Revoked doctor (Dr. Ananya) receives HTTP 403 Forbidden on patient records"
  );

  // 7. Unauthorized doctor receives 403 on file download
  const ananyaFileRes = await fetch(`${API_BASE}/api/records/${record._id}/file`, {
    headers: { Authorization: `Bearer ${ananyaToken}` },
  });
  assert(
    ananyaFileRes.status === 403,
    "7. Revoked doctor (Dr. Ananya) receives HTTP 403 Forbidden on file download"
  );

  // 8. Doctor calling patient-only endpoint (/api/records) is rejected with 403
  const doctorOnPatientEndpoint = await fetch(`${API_BASE}/api/records`, {
    headers: { Authorization: `Bearer ${doctorLoginData.token}` },
  });
  assert(
    doctorOnPatientEndpoint.status === 403,
    "8. Doctor calling patient-only endpoint (/api/records) is rejected with 403"
  );

  // 9. Missing or expired token receives 401
  const missingTokenRes = await fetch(`${API_BASE}/api/records/patient/${patient._id}`);
  const expiredToken = jwt.sign(
    { userId: doctorRahul._id.toString(), role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: -10 }
  );
  const expiredTokenRes = await fetch(`${API_BASE}/api/records/patient/${patient._id}`, {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert(
    missingTokenRes.status === 401 && expiredTokenRes.status === 401,
    "9. Missing or expired token returns HTTP 401 Unauthorized"
  );

  // 10. Patient integrity verification remains functional for patient
  const verifyRes = await fetch(`${API_BASE}/api/records/${record._id}/verify`, {
    headers: { Authorization: `Bearer ${satyaToken}` },
  });
  const verifyData = await verifyRes.json();
  assert(
    verifyRes.status === 200 && verifyData.integrityVerified === true,
    "10. Patient record integrity verification remains functional and verified"
  );

  // 11. Doctor calling verification endpoint gets 403 (enforces patient ownership limitation)
  const doctorVerifyRes = await fetch(`${API_BASE}/api/records/${record._id}/verify`, {
    headers: { Authorization: `Bearer ${doctorLoginData.token}` },
  });
  assert(
    doctorVerifyRes.status === 403,
    "11. Doctor calling /api/records/:id/verify receives 403 (policy limitation properly preserved)"
  );

  console.log("==================================================");
  console.log(`TOTAL TESTS: ${testsPassed + testsFailed}`);
  console.log(`  PASSED: ${testsPassed}`);
  console.log(`  FAILED: ${testsFailed}`);
  console.log("==================================================");

  await mongoose.disconnect();
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
