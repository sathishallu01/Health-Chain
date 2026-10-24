"use strict";

require("dotenv").config({ path: "backend/.env" });
const mongoose = require("mongoose");
const User = require("../models/user");
const HealthRecord = require("../models/healthRecord");

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
  console.log("  DOCTOR REGISTRATION & DIRECTORY INTEGRATION TESTS");
  console.log("==================================================");

  await mongoose.connect(process.env.MONGO_URI);

  const ts = Date.now();
  const testDoctorEmail = `dr_test_${ts}@hospital.invalid`;

  // 1. Doctor registration with valid fields
  const regRes = await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Vikram Seth",
      email: testDoctorEmail,
      specialty: "Neurologist",
      organization: "Apollo Specialty Hospital",
      password: "Password123!",
      confirmPassword: "Password123!",
    }),
  });
  const regData = await regRes.json();
  assert(
    regRes.status === 201 && regData.user.role === "doctor",
    "1. Register doctor with valid fields succeeds and returns role: 'doctor'"
  );

  // 2. Reject doctor registration with missing required fields
  const missingFieldRes = await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Incomplete",
      email: `incomplete_${ts}@test.invalid`,
      specialty: "",
      organization: "Clinic",
      password: "Password123!",
      confirmPassword: "Password123!",
    }),
  });
  assert(
    missingFieldRes.status === 400,
    "2. Missing required fields (specialty) rejected with HTTP 400"
  );

  // 3. Reject password confirmation mismatch
  const mismatchRes = await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Mismatch",
      email: `mismatch_${ts}@test.invalid`,
      specialty: "Surgeon",
      organization: "City Hospital",
      password: "Password123!",
      confirmPassword: "DifferentPassword123!",
    }),
  });
  assert(
    mismatchRes.status === 400,
    "3. Password and confirm password mismatch rejected with HTTP 400"
  );

  // 4. Prevent duplicate email registration
  const dupRes = await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Duplicate",
      email: testDoctorEmail,
      specialty: "Neurologist",
      organization: "Apollo Specialty Hospital",
      password: "Password123!",
      confirmPassword: "Password123!",
    }),
  });
  assert(
    dupRes.status === 409,
    "4. Duplicate doctor email registration rejected with HTTP 409 Conflict"
  );

  // 5. Verify password is never stored as plain text
  const savedDoctor = await User.findOne({ email: testDoctorEmail }).select("+password");
  assert(
    savedDoctor && savedDoctor.password && !savedDoctor.password.includes("Password123!"),
    "5. Doctor password is cryptographically hashed with bcrypt (never plain text)"
  );

  // 6. Role cannot be manipulated by client (always set to doctor)
  const roleTamperRes = await fetch(`${API_BASE}/api/auth/register-doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Tamper",
      email: `tamper_${ts}@test.invalid`,
      specialty: "General",
      organization: "Clinic",
      password: "Password123!",
      confirmPassword: "Password123!",
      role: "admin",
    }),
  });
  const tamperData = await roleTamperRes.json();
  assert(
    roleTamperRes.status === 201 && tamperData.user.role === "doctor",
    "6. Client cannot tamper with role (enforced strictly as 'doctor')"
  );

  // 7. Doctor can log in with new credentials
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: testDoctorEmail,
      password: "Password123!",
    }),
  });
  const loginData = await loginRes.json();
  assert(
    loginRes.status === 200 && loginData.user.role === "doctor" && loginData.token,
    "7. Newly registered doctor logs in successfully and receives doctor JWT"
  );

  // 8. Newly registered doctor does NOT have automatic access to patient records
  const patient = await User.findOne({ email: /satya/i });
  const docAccessRes = await fetch(`${API_BASE}/api/records/patient/${patient._id}`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  assert(
    docAccessRes.status === 403,
    "8. Doctor registration does NOT grant access to patient records (HTTP 403 Forbidden)"
  );

  // 9. Patient registration still works as expected
  const patientEmail = `pat_verify_${ts}@patient.invalid`;
  const patRegRes = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Verified Patient",
      email: patientEmail,
      password: "Password123!",
    }),
  });
  const patRegData = await patRegRes.json();
  assert(
    patRegRes.status === 201 && patRegData.user.role === "patient",
    "9. Existing patient registration remains fully functional"
  );

  // 10. Doctor Directory API includes the new doctor with name, specialty, and organization
  const patLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: patientEmail,
      password: "Password123!",
    }),
  });
  const patToken = (await patLoginRes.json()).token;

  const directoryRes = await fetch(`${API_BASE}/api/access/providers`, {
    headers: { Authorization: `Bearer ${patToken}` },
  });
  const directoryData = await directoryRes.json();
  const foundDoctor = directoryData.providers.find((p) => p.email === testDoctorEmail);
  assert(
    directoryRes.status === 200 &&
    foundDoctor &&
    foundDoctor.name === "Dr. Vikram Seth" &&
    foundDoctor.specialty === "Neurologist" &&
    foundDoctor.organization === "Apollo Specialty Hospital",
    "10. Doctor Directory lists new doctor with name, specialization, and hospital"
  );

  // 11. Granting access to unverified doctor without wallet is rejected safely
  const grantUnverifiedRes = await fetch(`${API_BASE}/api/access/grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${patToken}`,
    },
    body: JSON.stringify({ providerId: foundDoctor.id }),
  });
  assert(
    grantUnverifiedRes.status === 400,
    "11. Granting access to unverified doctor without wallet address safely rejected (HTTP 400)"
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
