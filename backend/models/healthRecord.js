"use strict";

/**
 * healthRecord.js — Mongoose model
 *
 * Stores metadata for each uploaded health record.  The actual file is kept
 * on disk at storagePath (outside any public/static directory).  storagePath
 * is explicitly excluded from every API response via a toJSON transform and
 * a default projection of -storagePath on all public queries.
 */

const mongoose = require("mongoose");

const ALLOWED_TYPES = [
  "Laboratory",
  "Consultation",
  "Radiology",
  "Prescription",
  "Other",
];

const BLOCKCHAIN_STATUSES = ["pending", "verified", "failed"];

const healthRecordSchema = new mongoose.Schema(
  {
    // ── Ownership ────────────────────────────────────────────────────────────
    patient: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "Patient reference is required"],
      index:    true,
    },

    // ── Record metadata (user-supplied) ──────────────────────────────────────
    name: {
      type:      String,
      required:  [true, "Record name is required"],
      trim:      true,
      minlength: [1,  "Record name must not be empty"],
      maxlength: [200, "Record name must be at most 200 characters"],
    },

    type: {
      type:     String,
      required: [true, "Record type is required"],
      enum: {
        values:  ALLOWED_TYPES,
        message: `Type must be one of: ${ALLOWED_TYPES.join(", ")}`,
      },
    },

    // ── File metadata (set by the backend, not user-controlled) ─────────────
    originalName: {
      type:    String,
      default: "",
    },

    mimeType: {
      type:    String,
      default: "",
    },

    sizeBytes: {
      type:    Number,
      default: 0,
      min:     [1, "File must not be empty"],
    },

    /**
     * SHA-256 hex digest of the uploaded file.
     * Exactly 64 lowercase hex characters.
     * This is the value registered on-chain via addRecord().
     */
    fileHash: {
      type:     String,
      required: [true, "File hash is required"],
      match:    [/^[a-f0-9]{64}$/, "fileHash must be a 64-character hex SHA-256 digest"],
    },

    /**
     * Absolute path to the stored file on the server's filesystem.
     * NEVER returned in API responses — stripped by the toJSON transform
     * and by explicit -storagePath projection on public queries.
     */
    storagePath: {
      type:   String,
      select: false, // excluded by default from all queries
    },

    // ── Blockchain state ─────────────────────────────────────────────────────
    /**
     * Ethereum transaction hash returned after addRecord() succeeds.
     * null until a blockchain write completes.
     */
    txHash: {
      type:    String,
      default: null,
    },

    blockNumber: {
      type:    Number,
      default: null,
    },

    /**
     * 'pending'  — record saved to DB; blockchain write not yet attempted or in progress.
     * 'verified' — addRecord() tx confirmed on-chain; txHash and blockNumber are set.
     * 'failed'   — blockchain write attempted but failed; record is still stored locally.
     */
    blockchainStatus: {
      type:     String,
      enum:     BLOCKCHAIN_STATUSES,
      default:  "pending",
      required: true,
    },

    // ── Soft delete ──────────────────────────────────────────────────────────
    isDeleted: {
      type:    Boolean,
      default: false,
    },
  },
  {
    timestamps: true,

    toJSON: {
      // Strip storagePath from all JSON serialisation.
      // Express's res.json() calls .toJSON() on Mongoose documents automatically.
      transform: function (doc, ret) {
        delete ret.storagePath;
        return ret;
      },
    },
  }
);

// Compound index: fast lookup of a patient's active records.
healthRecordSchema.index({ patient: 1, isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("HealthRecord", healthRecordSchema);
