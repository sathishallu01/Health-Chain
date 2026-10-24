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
  console.log("  DOCTOR PATIENT EMAIL LOOKUP INTEGRATION TESTS");
  console.log("==================================================");

  await mongoose.connect(process.env.MONGO_URI);
  await blockchainService.init();

  // Find users
  const patient = await User.findOne({ email: /satya/i });
  const doctorRahul = await User.findOne({ email: /rahul.sharma/i });
  const doctorPriya = await User.findOne({ email: /priya.kumar/i });

  if (!patient || !doctorRahul || !doctorPriya) {
    throw new Error("Seeded test users (satya, rahul.sharma, priya.kumar) not found.");
  }

  // Obtain tokens via actual login endpoint
  const rahulLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: doctorRahul.email, password: "Password123!" }),
  });
  const rahulLoginData = await rahulLoginRes.json();
  const rahulToken = rahulLoginData.token;

  const priyaLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: doctorPriya.email, password: "Password123!" }),
  });
  const priyaLoginData = await priyaLoginRes.json();
  const priyaToken = priyaLoginData.token;

  const patientToken = jwt.sign(
    { userId: patient._id.toString(), role: "patient" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 1. Unauthenticated request rejected (401)
  const unauthRes = await fetch(`${API_BASE}/api/records/patient-by-email?email=${encodeURIComponent(patient.email)}`);
  assert(
    unauthRes.status === 401,
    "1. Unauthenticated request to /patient-by-email returns 401 Unauthorized"
  );

  // 2. Patient role rejected from provider lookup endpoint (403)
  const patientRoleRes = await fetch(
    `${API_BASE}/api/records/patient-by-email?email=${encodeURIComponent(patient.email)}`,
    { headers: { Authorization: `Bearer ${patientToken}` } }
  );
  assert(
    patientRoleRes.status === 403,
    "2. Patient role request to /patient-by-email returns 403 Forbidden"
  );

  // 3. Missing email parameter returns 400
  const missingEmailRes = await fetch(`${API_BASE}/api/records/patient-by-email`, {
    headers: { Authorization: `Bearer ${rahulToken}` },
  });
  assert(
    missingEmailRes.status === 400,
    "3. Request without email query parameter returns 400 Bad Request"
  );

  // 4. Invalid email format returns 400
  const invalidEmailRes = await fetch(`${API_BASE}/api/records/patient-by-email?email=invalid-email-format`, {
    headers: { Authorization: `Bearer ${rahulToken}` },
  });
  assert(
    invalidEmailRes.status === 400,
    "4. Request with invalid email format returns 400 Bad Request"
  );

  // 5. Non-existent patient email returns 404
  const notFoundRes = await fetch(
    `${API_BASE}/api/records/patient-by-email?email=nonexistent_patient_9999@example.com`,
    { headers: { Authorization: `Bearer ${rahulToken}` } }
  );
  const notFoundData = await notFoundRes.json();
  assert(
    notFoundRes.status === 404 && notFoundData.success === false,
    "5. Non-existent patient email returns 404 Not Found"
  );

  // 6. Authorized doctor (Dr. Rahul) with patient email (satya@gmail.com) succeeds (200)
  const authDocRes = await fetch(
    `${API_BASE}/api/records/patient-by-email?email=${encodeURIComponent(patient.email)}`,
    { headers: { Authorization: `Bearer ${rahulToken}` } }
  );
  const authDocData = await authDocRes.json();
  assert(
    authDocRes.status === 200 &&
      authDocData.success === true &&
      authDocData.patient.email === patient.email &&
      authDocData.patient.id === patient._id.toString() &&
      Array.isArray(authDocData.records) &&
      authDocData.count > 0,
    "6. Authorized doctor (Dr. Rahul) retrieves records for patient by email with safe metadata"
  );

  // Verify no passwords, hashes or private keys exposed in patient metadata
  assert(
    authDocData.patient.password === undefined &&
      authDocData.patient.privateKey === undefined &&
      authDocData.patient.mnemonic === undefined,
    "6b. Patient response safely omits sensitive fields (no password hashes or keys)"
  );

  // 7. Revoked/unauthorized doctor (Dr. Priya) with patient email receives 403 Forbidden
  const unauthDocRes = await fetch(
    `${API_BASE}/api/records/patient-by-email?email=${encodeURIComponent(patient.email)}`,
    { headers: { Authorization: `Bearer ${priyaToken}` } }
  );
  const unauthDocData = await unauthDocRes.json();
  assert(
    unauthDocRes.status === 403 &&
      unauthDocData.success === false &&
      unauthDocData.records === undefined,
    "7. Unauthorized/revoked doctor (Dr. Priya) receives 403 Forbidden with zero records"
  );

  // 8. Newly registered doctor without wallet/access receives 403 Forbidden
  const ts = Date.now();
  const newDocEmail = `testdoc_${ts}@diagnostic.invalid`;
  await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. New Test",
      email: newDocEmail,
      specialty: "Neurology",
      organization: "General Hospital",
      password: "Password123!",
      confirmPassword: "Password123!",
    }),
  });
  const newDocLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newDocEmail, password: "Password123!" }),
  });
  const newDocLoginData = await newDocLoginRes.json();

  const newDocQueryRes = await fetch(
    `${API_BASE}/api/records/patient-by-email?email=${encodeURIComponent(patient.email)}`,
    { headers: { Authorization: `Bearer ${newDocLoginData.token}` } }
  );
  assert(
    newDocQueryRes.status === 403,
    "8. Newly registered doctor without on-chain authorization receives 403 Forbidden"
  );

  console.log("--------------------------------------------------");
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log("==================================================");

  await mongoose.disconnect();

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
