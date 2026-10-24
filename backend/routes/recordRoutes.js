"use strict";

/**
 * recordRoutes.js
 *
 * Express router for health records management:
 *   POST /api/records  — upload a new patient health record (multipart/form-data)
 *   GET  /api/records  — retrieve the authenticated patient's health records
 *
 * Middleware pipeline order enforced:
 *   1. authMiddleware: verifies JWT token and attaches req.user = { userId, role }
 *   2. requirePatientRole: ensures req.user.role === "patient" (returns 403 Forbidden otherwise)
 *   3. multerMiddleware: handles file upload, size checks, and disk destination (POST only)
 *   4. Controller handler: uploadRecord or getRecords
 */

const express = require("express");
const router  = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  multerMiddleware,
  uploadRecord,
  getRecords,
  getPatientRecordsForProvider,
  getPatientRecordsByEmailForProvider,
  verifyRecordIntegrity,
  registerRecordOnBlockchain,
  getRecordFile,
} = require("../controllers/recordController");

/**
 * Authorization middleware ensuring only authenticated patients can access record routes.
 */
function requirePatientRole(req, res, next) {
  if (!req.user || req.user.role !== "patient") {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Only patients are authorized to access health records.",
    });
  }
  next();
}

// POST /api/records — patient upload
router.post(
  "/",
  authMiddleware,
  requirePatientRole,
  multerMiddleware,
  uploadRecord
);

// GET /api/records — patient list own records
router.get(
  "/",
  authMiddleware,
  requirePatientRole,
  getRecords
);

// GET /api/records/patient-by-email — authorized provider lookup of patient records by email
router.get(
  "/patient-by-email",
  authMiddleware,
  getPatientRecordsByEmailForProvider
);

// GET /api/records/patient/:patientId — authorized provider view of patient records
router.get(
  "/patient/:patientId",
  authMiddleware,
  getPatientRecordsForProvider
);

// GET /api/records/:id/verify — patient integrity verification
router.get(
  "/:id/verify",
  authMiddleware,
  requirePatientRole,
  verifyRecordIntegrity
);

// POST /api/records/:id/register — patient register/sync record on blockchain
router.post(
  "/:id/register",
  authMiddleware,
  requirePatientRole,
  registerRecordOnBlockchain
);

// GET /api/records/:id/file — patient or authorized provider download/preview
router.get(
  "/:id/file",
  authMiddleware,
  getRecordFile
);

module.exports = router;
