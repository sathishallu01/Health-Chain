"use strict";

/**
 * recordController.js
 *
 * POST /api/records  — upload a health record file with metadata
 * GET  /api/records  — list the authenticated patient's own records
 *
 * Security guarantees enforced here:
 * ────────────────────────────────────
 * • All routes require a valid JWT with patient role.
 * • Ownership is enforced by querying always with { patient: req.user.userId }.
 * • Files are stored in backend/uploads/{userId}/ — outside any public route.
 * • storagePath is NEVER included in API responses (excluded at model and query level).
 * • File type is validated by MIME type, file extension, and binary file signatures (magic bytes).
 * • Max upload size is read from MAX_UPLOAD_MB environment variable (default 5 MB).
 * • Streaming SHA-256 hash is computed asynchronously without loading entire files into memory.
 * • Blockchain failure is caught and handled without corrupting or deleting the DB record.
 */

const path             = require("path");
const fs               = require("fs");
const crypto           = require("crypto");
const multer           = require("multer");
const mongoose         = require("mongoose");
const User             = require("../models/user");
const HealthRecord     = require("../models/healthRecord");
const { computeFileHash } = require("../utils/hashFile");
const blockchainService   = require("../services/blockchain/blockchainService");

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = ["application/pdf", "image/jpeg", "image/png"];
const ALLOWED_EXTS  = [".pdf", ".jpg", ".jpeg", ".png"];

const ALLOWED_RECORD_TYPES = [
  "Laboratory",
  "Consultation",
  "Radiology",
  "Prescription",
  "Other",
];

// Files are written to backend/uploads/{userId}/ — no public route serves this.
const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

// Max file size in bytes (read once at module load; env is set by dotenv before require).
const MAX_BYTES =
  (parseInt(process.env.MAX_UPLOAD_MB, 10) || 5) * 1024 * 1024;

// ── Multer configuration ─────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // req.user is set by authMiddleware before multer runs.
    if (!req.user || !req.user.userId) {
      return cb(new Error("Authentication required before file upload."));
    }
    const dir = path.join(UPLOADS_ROOT, req.user.userId.toString());
    try {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },

  filename: function (req, file, cb) {
    const ext        = path.extname(file.originalname).toLowerCase();
    const randomPart = crypto.randomBytes(16).toString("hex");
    // Format: {timestamp}-{random}{ext}  — prevents collisions and directory traversal.
    cb(null, `${Date.now()}-${randomPart}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
  const extOk  = ALLOWED_EXTS.includes(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    // Passing an Error causes multer to abort without saving.
    cb(
      new Error(
        `Unsupported file type '${file.mimetype}'. ` +
        `Only PDF, JPEG, and PNG files are accepted.`
      )
    );
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES },
});

// ── Exported multer middleware ────────────────────────────────────────────────
// Used by the router as: router.post("/", requirePatientRole, multerMiddleware, uploadRecord)

function multerMiddleware(req, res, next) {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        message: `Upload rejected: ${err.message} (max ${process.env.MAX_UPLOAD_MB || 5} MB).`,
      });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}

// ── Helper: delete a file safely (best-effort, never throws) ─────────────────

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore — not worth crashing over a cleanup failure.
  }
}

// ── Helper: detect file signature (magic bytes) ──────────────────────────────

/**
 * Inspects initial bytes of saved file to verify binary signature.
 *
 * Supported signatures:
 *   - PDF:  %PDF (0x25 0x50 0x44 0x46)
 *   - PNG:  0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 *   - JPEG: 0xFF 0xD8 0xFF
 *
 * @param {string} filePath - Absolute path to file on disk.
 * @returns {Promise<string|null>} "pdf" | "png" | "jpeg" | null
 */
async function detectFileSignature(filePath) {
  let fileHandle;
  try {
    fileHandle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await fileHandle.read(buffer, 0, 8, 0);

    if (bytesRead < 3) return null;

    // PDF magic bytes: 0x25 0x50 0x44 0x46 (%PDF)
    if (
      bytesRead >= 4 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return "pdf";
    }

    // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
      bytesRead >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return "png";
    }

    // JPEG magic bytes: 0xFF 0xD8 0xFF
    if (
      bytesRead >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return "jpeg";
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

/**
 * Validates that the detected signature matches MIME type and file extension.
 *
 * @param {string} detected - "pdf" | "png" | "jpeg" | null
 * @param {string} mimeType - Declared MIME type
 * @param {string} ext - Lowercase extension (e.g. ".pdf")
 * @returns {boolean}
 */
function isSignatureValid(detected, mimeType, ext) {
  if (!detected) return false;

  if (detected === "pdf") {
    return mimeType === "application/pdf" && ext === ".pdf";
  }

  if (detected === "png") {
    return mimeType === "image/png" && ext === ".png";
  }

  if (detected === "jpeg") {
    return (
      mimeType === "image/jpeg" &&
      (ext === ".jpg" || ext === ".jpeg")
    );
  }

  return false;
}

// ── Helper: build public-safe record object ───────────────────────────────────

function sanitiseRecord(doc) {
  const obj = doc.toObject({ transform: true });
  delete obj.storagePath;
  return obj;
}

// ── POST /api/records ─────────────────────────────────────────────────────────

/**
 * Upload a health record file.
 *
 * Request (multipart/form-data):
 *   file  {File}   — PDF, JPEG, or PNG (required)
 *   name  {string} — Human-readable record name (required)
 *   type  {string} — One of: Laboratory, Consultation, Radiology,
 *                    Prescription, Other (required)
 *
 * Response 201:
 *   { message, record: { ...fields, blockchainStatus } }
 *
 * storagePath is NEVER included in the response.
 */
async function uploadRecord(req, res) {
  const file = req.file;

  // ── 1. File presence ────────────────────────────────────────────────────────
  if (!file) {
    return res.status(400).json({ message: "A file is required." });
  }

  // ── 2. Validate text metadata ───────────────────────────────────────────────
  const rawName = req.body.name;
  const rawType = req.body.type;

  if (!rawName || typeof rawName !== "string" || rawName.trim().length === 0) {
    safeUnlink(file.path);
    return res.status(400).json({ message: "Record name is required." });
  }

  if (rawName.trim().length > 200) {
    safeUnlink(file.path);
    return res.status(400).json({
      message: "Record name must be at most 200 characters.",
    });
  }

  if (!rawType || !ALLOWED_RECORD_TYPES.includes(rawType)) {
    safeUnlink(file.path);
    return res.status(400).json({
      message: `Record type must be one of: ${ALLOWED_RECORD_TYPES.join(", ")}.`,
    });
  }

  // ── 3. File signature verification (magic bytes) ───────────────────────────
  const ext = path.extname(file.originalname).toLowerCase();
  const detectedFormat = await detectFileSignature(file.path);

  if (!isSignatureValid(detectedFormat, file.mimetype, ext)) {
    safeUnlink(file.path);
    return res.status(400).json({
      message: "File signature validation failed. File content does not match the expected format.",
    });
  }

  // ── 4. Compute SHA-256 hash via streaming ───────────────────────────────────
  let fileHash;
  try {
    fileHash = await computeFileHash(file.path);
  } catch (err) {
    safeUnlink(file.path);
    console.error("[recordController] Hash computation failed:", err.message);
    return res.status(500).json({
      message: "Could not process the uploaded file.",
    });
  }

  // ── 5. Persist record (blockchainStatus starts as 'pending') ────────────────
  let record;
  try {
    record = await HealthRecord.create({
      patient:          req.user.userId,
      name:             rawName.trim(),
      type:             rawType,
      fileHash,
      originalName:     file.originalname,
      mimeType:         file.mimetype,
      sizeBytes:        file.size,
      storagePath:      file.path,
      blockchainStatus: "pending",
    });
  } catch (err) {
    safeUnlink(file.path);
    console.error("[recordController] DB create failed:", err.message);
    return res.status(500).json({ message: "Failed to save record." });
  }

  // ── 6. Register hash on blockchain ─────────────────────────────────────────
  if (blockchainService.isAvailable()) {
    try {
      const { txHash, blockNumber } = await blockchainService.addRecord(
        req.user.userId.toString(),
        fileHash
      );

      record.txHash           = txHash;
      record.blockNumber      = blockNumber;
      record.blockchainStatus = "verified";
      await record.save();
    } catch (err) {
      console.error(
        "[recordController] Blockchain write failed — record stays saved, status set to failed:",
        err.message
      );
      record.blockchainStatus = "failed";
      try {
        await record.save();
      } catch (saveErr) {
        console.error("[recordController] Could not update blockchainStatus:", saveErr.message);
      }
    }
  } else {
    console.info(
      "[recordController] Blockchain not available — record saved locally only.",
      blockchainService.unavailableReason()
    );
  }

  // ── 7. Respond ──────────────────────────────────────────────────────────────
  return res.status(201).json({
    message: "Record uploaded successfully.",
    record:  sanitiseRecord(record),
  });
}

// ── GET /api/records ──────────────────────────────────────────────────────────

/**
 * Return all active health records belonging to the authenticated patient.
 */
async function getRecords(req, res) {
  if (req.query.patientId && req.query.patientId.toString() !== req.user.userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Patients can only access their own records.",
    });
  }

  try {
    const records = await HealthRecord
      .find({ patient: req.user.userId, isDeleted: false })
      .select("-storagePath")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      records,
      count: records.length,
    });
  } catch (err) {
    console.error("[recordController] getRecords error:", err.message);
    return res.status(500).json({ message: "Failed to retrieve records." });
  }
}

// ── GET /api/records/:id/verify ──────────────────────────────────────────────

/**
 * Verify integrity of a health record against the stored file and blockchain.
 *
 * GET /api/records/:id/verify
 *
 * Requirements:
 * - Only the record owner (authenticated patient) may verify.
 * - Explicitly selects storagePath from the database.
 * - Returns 404 if the record does not exist or does not belong to the patient.
 * - Recalculates file SHA-256 via computeFileHash(). Safe if file is missing/unreadable.
 * - Compares calculated hash with stored record.fileHash.
 * - Checks if stored fileHash is registered on-chain via blockchainService.getRecordHashes().
 * - Returns { integrityVerified, fileMatchesDatabase, hashRegisteredOnBlockchain, message }
 * - Never exposes storagePath or sensitive details.
 */
async function verifyRecordIntegrity(req, res) {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Record not found." });
  }

  try {
    const record = await HealthRecord.findOne({
      _id: id,
      patient: req.user.userId,
      isDeleted: false,
    }).select("+storagePath");

    if (!record) {
      return res.status(404).json({ message: "Record not found." });
    }

    // 1. Recalculate file hash and compare with database
    let fileMatchesDatabase = false;
    let fileExists = false;

    if (record.storagePath) {
      try {
        if (fs.existsSync(record.storagePath)) {
          fileExists = true;
          const calculatedHash = await computeFileHash(record.storagePath);
          if (
            calculatedHash &&
            record.fileHash &&
            calculatedHash.toLowerCase() === record.fileHash.toLowerCase()
          ) {
            fileMatchesDatabase = true;
          }
        }
      } catch (fileErr) {
        console.warn(
          `[recordController] Verification failed to hash file for record ${id}:`,
          fileErr.message
        );
        fileMatchesDatabase = false;
      }
    }

    // 2. Check if record hash is registered on blockchain
    let hashRegisteredOnBlockchain = false;
    try {
      const onChainHashes = await blockchainService.getRecordHashes(
        req.user.userId.toString()
      );
      if (Array.isArray(onChainHashes) && record.fileHash) {
        const targetHash = record.fileHash.toLowerCase();
        hashRegisteredOnBlockchain = onChainHashes.some(
          (h) => typeof h === "string" && h.toLowerCase() === targetHash
        );
      }
    } catch (bcErr) {
      console.warn(
        `[recordController] Could not retrieve on-chain hashes for patient ${req.user.userId}:`,
        bcErr.message
      );
      hashRegisteredOnBlockchain = false;
    }

    // 3. Overall integrity verification
    const integrityVerified = Boolean(
      fileMatchesDatabase && hashRegisteredOnBlockchain
    );

    // 4. Construct human-readable message
    let message;
    if (integrityVerified) {
      message = "Record integrity verified successfully. File matches database and is registered on the blockchain.";
    } else if (!fileExists) {
      message = "File integrity check failed: stored file is missing or unreadable on server.";
    } else if (!fileMatchesDatabase && !hashRegisteredOnBlockchain) {
      message = "File integrity check failed: file content does not match database and hash is not registered on the blockchain.";
    } else if (!fileMatchesDatabase) {
      message = "File integrity check failed: file content does not match stored database hash.";
    } else {
      message = "File integrity check failed: record hash is not registered on the blockchain.";
    }

    return res.status(200).json({
      integrityVerified,
      fileMatchesDatabase,
      hashRegisteredOnBlockchain,
      message,
    });
  } catch (err) {
    console.error("[recordController] verifyRecordIntegrity error:", err.message);
    return res.status(500).json({ message: "Failed to verify record integrity." });
  }
}

// ── POST /api/records/:id/register ───────────────────────────────────────────

/**
 * Re-register or synchronize an existing patient health record hash to the blockchain.
 *
 * POST /api/records/:id/register
 */
async function registerRecordOnBlockchain(req, res) {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ success: false, message: "Record not found." });
  }

  try {
    const record = await HealthRecord.findOne({
      _id: id,
      patient: req.user.userId,
      isDeleted: false,
    }).select("+storagePath");

    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }

    // 1. Verify file exists on disk
    if (!record.storagePath || !fs.existsSync(record.storagePath)) {
      return res.status(400).json({
        success: false,
        message: "Cannot register on blockchain: stored file is missing or unreadable on server.",
      });
    }

    // 2. Recompute SHA-256 hash from disk
    let calculatedHash;
    try {
      calculatedHash = await computeFileHash(record.storagePath);
    } catch (hashErr) {
      return res.status(500).json({
        success: false,
        message: `Failed to compute file hash: ${hashErr.message}`,
      });
    }

    // 3. Compare calculated hash against stored database hash
    if (!calculatedHash || calculatedHash.toLowerCase() !== record.fileHash.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Cannot register on blockchain: file content does not match stored database hash.",
      });
    }

    // 4. Ensure blockchain service is available
    if (!blockchainService.isAvailable()) {
      await blockchainService.init();
      if (!blockchainService.isAvailable()) {
        return res.status(503).json({
          success: false,
          message: `Blockchain service unavailable: ${blockchainService.unavailableReason()}`,
        });
      }
    }

    const patientId = req.user.userId.toString();
    const targetHash = record.fileHash.toLowerCase();

    // 5. Check if already registered on-chain
    let onChainHashes = [];
    try {
      onChainHashes = await blockchainService.getRecordHashes(patientId);
    } catch (checkErr) {
      console.warn("[recordController] getRecordHashes check failed:", checkErr.message);
    }

    const alreadyRegistered = Array.isArray(onChainHashes) && onChainHashes.some(
      (h) => typeof h === "string" && h.toLowerCase() === targetHash
    );

    let txHash = record.txHash;
    let blockNumber = record.blockNumber;

    if (!alreadyRegistered) {
      try {
        const txResult = await blockchainService.addRecord(patientId, targetHash);
        txHash = txResult.txHash;
        blockNumber = txResult.blockNumber;
      } catch (bcErr) {
        console.error("[recordController] addRecord failed:", bcErr.message);
        return res.status(500).json({
          success: false,
          message: `Blockchain transaction failed: ${bcErr.message}`,
        });
      }

      // 6. Verify result by reading back from blockchain
      const updatedHashes = await blockchainService.getRecordHashes(patientId);
      const isConfirmed = Array.isArray(updatedHashes) && updatedHashes.some(
        (h) => typeof h === "string" && h.toLowerCase() === targetHash
      );

      if (!isConfirmed) {
        return res.status(500).json({
          success: false,
          message: "Transaction submitted but hash could not be confirmed on blockchain.",
        });
      }
    }

    // 7. Update record metadata in database
    record.txHash = txHash;
    record.blockNumber = blockNumber;
    record.blockchainStatus = "verified";
    await record.save();

    return res.status(200).json({
      success: true,
      message: alreadyRegistered
        ? "Record hash was already registered on the blockchain. Status updated to verified."
        : "Record successfully registered on the blockchain.",
      txHash,
      blockNumber,
      blockchainStatus: "verified",
    });
  } catch (err) {
    console.error("[recordController] registerRecordOnBlockchain error:", err.message);
    return res.status(500).json({
      success: false,
      message: `Failed to register record on blockchain: ${err.message}`,
    });
  }
}

// ── GET /api/records/patient/:patientId ───────────────────────────────────────

/**
 * Retrieve a patient's health records for an authorized healthcare provider.
 * Strictly verifies live on-chain permission via HealthRecordContract.hasAccess().
 */
async function getPatientRecordsForProvider(req, res) {
  const { patientId } = req.params;

  if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
    return res.status(400).json({
      success: false,
      message: "A valid patientId is required.",
    });
  }

  if (!["doctor", "hospital"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Only authorized healthcare providers can access patient records via this endpoint.",
    });
  }

  try {
    const provider = await User.findById(req.user.userId)
      .select("ethereumAddress isWalletVerified")
      .lean();

    if (!provider || !provider.ethereumAddress || !provider.isWalletVerified) {
      return res.status(403).json({
        success: false,
        message: "Access forbidden. Provider does not have a verified Ethereum wallet.",
      });
    }

    let hasAccess = false;
    try {
      hasAccess = await blockchainService.hasAccess(
        patientId.toString(),
        provider.ethereumAddress
      );
    } catch (bcErr) {
      console.error("[recordController] on-chain access check failed:", bcErr.message);
      return res.status(500).json({
        success: false,
        message: `Failed to verify on-chain permissions: ${bcErr.message}`,
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access forbidden. You do not have active on-chain permission to view this patient's records.",
      });
    }

    const records = await HealthRecord.find({
      patient: patientId,
      isDeleted: false,
    })
      .select("-storagePath")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      records,
      count: records.length,
    });
  } catch (err) {
    console.error("[recordController] getPatientRecordsForProvider error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve patient records.",
    });
  }
}

// ── GET /api/records/patient-by-email ─────────────────────────────────────────

/**
 * Retrieve a patient's health records for an authorized healthcare provider by patient email.
 * Strictly verifies live on-chain permission via HealthRecordContract.hasAccess().
 */
async function getPatientRecordsByEmailForProvider(req, res) {
  if (!["doctor", "hospital"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access forbidden. Only authorized healthcare providers can access patient records via this endpoint.",
    });
  }

  const email = req.query.email || req.body?.email;

  if (!email || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({
      success: false,
      message: "A valid patient email address is required.",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Find patient by email
    const patient = await User.findOne({
      email: normalizedEmail,
      role: "patient",
      isActive: true,
    })
      .select("_id name email")
      .lean();

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: `Patient not found with email: ${normalizedEmail}`,
      });
    }

    const patientId = patient._id.toString();

    // 2. Verify provider's linked and verified Ethereum wallet
    const provider = await User.findById(req.user.userId)
      .select("ethereumAddress isWalletVerified")
      .lean();

    if (!provider || !provider.ethereumAddress || !provider.isWalletVerified) {
      return res.status(403).json({
        success: false,
        message: "Access forbidden. Provider does not have a verified Ethereum wallet.",
      });
    }

    // 3. Strictly verify live on-chain permission via HealthRecordContract.hasAccess()
    let hasAccess = false;
    try {
      hasAccess = await blockchainService.hasAccess(
        patientId,
        provider.ethereumAddress
      );
    } catch (bcErr) {
      console.error("[recordController] on-chain access check failed by email lookup:", bcErr.message);
      return res.status(500).json({
        success: false,
        message: `Failed to verify on-chain permissions: ${bcErr.message}`,
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access forbidden. You do not have active on-chain permission to view records for patient ${patient.name || normalizedEmail}.`,
      });
    }

    // 4. Retrieve health records
    const records = await HealthRecord.find({
      patient: patientId,
      isDeleted: false,
    })
      .select("-storagePath")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      patient: {
        id: patient._id.toString(),
        name: patient.name,
        email: patient.email,
      },
      records,
      count: records.length,
    });
  } catch (err) {
    console.error("[recordController] getPatientRecordsByEmailForProvider error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve patient records.",
    });
  }
}

// ── GET /api/records/:id/file ────────────────────────────────────────────────

/**
 * Stream a health record file securely to the client.
 * Enforces ownership for patients or live on-chain authorization for healthcare providers.
 */
async function getRecordFile(req, res) {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Record not found." });
  }

  try {
    const record = await HealthRecord.findOne({
      _id: id,
      isDeleted: false,
    }).select("+storagePath");

    if (!record) {
      return res.status(404).json({ message: "Record not found." });
    }

    if (req.user.role === "patient") {
      if (record.patient.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Access forbidden. You do not own this health record.",
        });
      }
    } else if (["doctor", "hospital"].includes(req.user.role)) {
      const provider = await User.findById(req.user.userId)
        .select("ethereumAddress isWalletVerified")
        .lean();

      if (!provider || !provider.ethereumAddress || !provider.isWalletVerified) {
        return res.status(403).json({
          success: false,
          message: "Access forbidden. Provider does not have a verified Ethereum wallet.",
        });
      }

      let hasAccess = false;
      try {
        hasAccess = await blockchainService.hasAccess(
          record.patient.toString(),
          provider.ethereumAddress
        );
      } catch (bcErr) {
        return res.status(500).json({
          success: false,
          message: `Failed to verify on-chain permissions: ${bcErr.message}`,
        });
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "Access forbidden. You do not have active on-chain permission for this patient's records.",
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: "Access forbidden.",
      });
    }

    if (!record.storagePath || !fs.existsSync(record.storagePath)) {
      return res.status(404).json({ message: "Record file is missing or unreadable on server." });
    }

    res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(record.originalName || "record")}"`
    );

    const stream = fs.createReadStream(record.storagePath);
    stream.on("error", (err) => {
      console.error("[recordController] File stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to stream record file." });
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error("[recordController] getRecordFile error:", err.message);
    return res.status(500).json({ message: "Failed to retrieve record file." });
  }
}

module.exports = {
  multerMiddleware,
  uploadRecord,
  getRecords,
  getPatientRecordsForProvider,
  getPatientRecordsByEmailForProvider,
  verifyRecordIntegrity,
  registerRecordOnBlockchain,
  getRecordFile,
};
