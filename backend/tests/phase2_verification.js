"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

async function runTests() {
  console.log("==================================================");
  console.log("  PHASE 2 COMPREHENSIVE VERIFICATION SUITE");
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

  // 1. Health check
  await test("GET /api/health returns 200 and ok status", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, "ok");
  });

  // 2. Unauthenticated GET /api/records returns 401
  await test("GET /api/records without token returns 401 Unauthorized", async () => {
    const res = await fetch(`${BASE_URL}/api/records`);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // 3. Unauthenticated POST /api/records returns 401
  await test("POST /api/records without token returns 401 Unauthorized", async () => {
    const res = await fetch(`${BASE_URL}/api/records`, { method: "POST" });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // 4. Non-patient role receives 403 Forbidden
  const doctorToken = jwt.sign(
    { userId: "650000000000000000000099", role: "doctor" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  await test("GET /api/records with non-patient role returns 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/api/records`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  await test("POST /api/records with non-patient role returns 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  // 5. Register Patient 1
  const ts = Date.now();
  let patient1Token;
  let patient1User;
  await test("Register Patient 1 account", async () => {
    const email = `patient1_${ts}@test.invalid`;
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Patient One",
        email,
        password: "Password123!",
      }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.token);
    assert.strictEqual(data.user.role, "patient");
    patient1Token = data.token;
    patient1User = data.user;
  });

  // 6. Register Patient 2
  let patient2Token;
  let patient2User;
  await test("Register Patient 2 account", async () => {
    const email = `patient2_${ts}@test.invalid`;
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Patient Two",
        email,
        password: "Password123!",
      }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.token);
    assert.strictEqual(data.user.role, "patient");
    patient2Token = data.token;
    patient2User = data.user;
  });

  // 7. Upload valid synthetic PDF for Patient 1
  const pdfBytes = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"),
  ]);

  let pdfRecordId;
  await test("POST /api/records - Upload valid PDF record", async () => {
    const formData = new FormData();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    formData.append("file", blob, "lab_report.pdf");
    formData.append("name", "Blood Chemistry Panel");
    formData.append("type", "Laboratory");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.record);
    assert.strictEqual(data.record.name, "Blood Chemistry Panel");
    assert.strictEqual(data.record.type, "Laboratory");
    assert.strictEqual(data.record.patient, patient1User.id);
    assert.strictEqual(data.record.originalName, "lab_report.pdf");
    assert.strictEqual(data.record.mimeType, "application/pdf");
    assert.ok(["pending", "verified"].includes(data.record.blockchainStatus));
    assert.match(data.record.fileHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(data.record.storagePath, undefined, "storagePath must be omitted");
    pdfRecordId = data.record._id;
  });

  // 8. Upload valid synthetic PNG for Patient 1
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
  await test("POST /api/records - Upload valid PNG record", async () => {
    const formData = new FormData();
    const blob = new Blob([pngHeader], { type: "image/png" });
    formData.append("file", blob, "xray.png");
    formData.append("name", "Chest X-Ray Image");
    formData.append("type", "Radiology");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.record);
    assert.strictEqual(data.record.name, "Chest X-Ray Image");
    assert.strictEqual(data.record.type, "Radiology");
    assert.strictEqual(data.record.storagePath, undefined);
    assert.match(data.record.fileHash, /^[a-f0-9]{64}$/);
  });

  // 9. Upload valid synthetic JPEG for Patient 1
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  await test("POST /api/records - Upload valid JPEG record", async () => {
    const formData = new FormData();
    const blob = new Blob([jpegHeader], { type: "image/jpeg" });
    formData.append("file", blob, "skin_lesion.jpg");
    formData.append("name", "Dermatology Scan");
    formData.append("type", "Consultation");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.record);
    assert.strictEqual(data.record.name, "Dermatology Scan");
    assert.strictEqual(data.record.storagePath, undefined);
  });

  // 10. GET /api/records for Patient 1
  await test("GET /api/records - Patient 1 retrieves all 3 uploaded records", async () => {
    const res = await fetch(`${BASE_URL}/api/records`, {
      headers: { Authorization: `Bearer ${patient1Token}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.count, 3);
    assert.strictEqual(data.records.length, 3);
    for (const rec of data.records) {
      assert.strictEqual(rec.patient.toString(), patient1User.id);
      assert.strictEqual(rec.storagePath, undefined, "storagePath must be omitted from all items");
    }
    // Newest first
    assert.strictEqual(data.records[0].name, "Dermatology Scan");
    assert.strictEqual(data.records[1].name, "Chest X-Ray Image");
    assert.strictEqual(data.records[2].name, "Blood Chemistry Panel");
  });

  // 11. Patient isolation - Patient 2 retrieves zero records
  await test("GET /api/records - Patient 2 sees zero records (isolation check)", async () => {
    const res = await fetch(`${BASE_URL}/api/records`, {
      headers: { Authorization: `Bearer ${patient2Token}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.count, 0);
    assert.strictEqual(data.records.length, 0);
  });

  // 12. Spoofed file signature test
  const uploadsUserDir = path.join(__dirname, "..", "uploads", patient1User.id);
  const getFilesCount = () => {
    try {
      return fs.readdirSync(uploadsUserDir).length;
    } catch {
      return 0;
    }
  };

  const baselineCount = getFilesCount();

  await test("Reject spoofed PDF (fake text pretending to be PDF) and clean up file", async () => {
    const formData = new FormData();
    const fakeContent = Buffer.from("<html><script>alert(1)</script></html>");
    const blob = new Blob([fakeContent], { type: "application/pdf" });
    formData.append("file", blob, "malicious.pdf");
    formData.append("name", "Fake PDF Report");
    formData.append("type", "Laboratory");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /signature validation failed/i);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  // 13. Mismatched file signature test (PNG bytes with .pdf extension)
  await test("Reject signature/extension mismatch (PNG bytes with .pdf extension) and clean up", async () => {
    const formData = new FormData();
    const blob = new Blob([pngHeader], { type: "application/pdf" });
    formData.append("file", blob, "mismatched.pdf");
    formData.append("name", "Mismatched Format");
    formData.append("type", "Laboratory");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  // 14. Unsupported file extension / MIME
  await test("Reject unsupported file type (.exe) and clean up", async () => {
    const formData = new FormData();
    const blob = new Blob([Buffer.from("MZ9000")], { type: "application/x-msdownload" });
    formData.append("file", blob, "malware.exe");
    formData.append("name", "Dangerous File");
    formData.append("type", "Other");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /Unsupported file type/i);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  // 15. Oversized file (> 5MB)
  await test("Reject oversized file (> 5MB) and clean up", async () => {
    const formData = new FormData();
    const bigBuffer = Buffer.alloc(5.5 * 1024 * 1024); // 5.5 MB
    const blob = new Blob([bigBuffer], { type: "application/pdf" });
    formData.append("file", blob, "oversized.pdf");
    formData.append("name", "Huge Document");
    formData.append("type", "Consultation");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /Upload rejected/i);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  // 16. Missing metadata fields
  await test("Reject upload with missing record name and clean up", async () => {
    const formData = new FormData();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    formData.append("file", blob, "unnamed.pdf");
    formData.append("type", "Laboratory");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /name is required/i);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  await test("Reject upload with invalid record type and clean up", async () => {
    const formData = new FormData();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    formData.append("file", blob, "badtype.pdf");
    formData.append("name", "Invalid Type Record");
    formData.append("type", "NotAValidType");

    const res = await fetch(`${BASE_URL}/api/records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patient1Token}` },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /type must be one of/i);
    assert.strictEqual(getFilesCount(), baselineCount, "Rejected file must be cleaned up from disk");
  });

  console.log("==================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered unexpected error:", err);
  process.exit(1);
});
