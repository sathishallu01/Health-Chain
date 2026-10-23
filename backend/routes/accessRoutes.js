"use strict";

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  getProviders,
  grantAccess,
  revokeAccess,
  verifyProviderWallet,
} = require("../controllers/accessController");

/**
 * Middleware: ensure authenticated user has the 'patient' role.
 */
function requirePatientRole(req, res, next) {
  if (!req.user || req.user.role !== "patient") {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Only patients can manage health-record permissions.",
    });
  }
  next();
}

/**
 * Middleware: ensure authenticated user is a healthcare provider ('doctor' or 'hospital').
 */
function requireProviderRole(req, res, next) {
  if (!req.user || !["doctor", "hospital"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Only healthcare providers can verify wallet ownership.",
    });
  }
  next();
}

// GET /api/access/providers — List providers with live on-chain access status
router.get("/providers", authMiddleware, requirePatientRole, getProviders);

// POST /api/access/grant — Grant access to a verified healthcare provider
router.post("/grant", authMiddleware, requirePatientRole, grantAccess);

// POST /api/access/revoke — Revoke access from a healthcare provider
router.post("/revoke", authMiddleware, requirePatientRole, revokeAccess);

// POST /api/access/verify-wallet — Cryptographically verify provider Ethereum wallet
router.post("/verify-wallet", authMiddleware, requireProviderRole, verifyProviderWallet);

module.exports = router;
