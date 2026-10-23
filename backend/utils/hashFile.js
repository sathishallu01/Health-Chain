"use strict";

/**
 * hashFile.js
 *
 * Utility for computing the SHA-256 digest of a file already saved to disk.
 * Uses Node.js streaming API (fs.createReadStream) to handle files of any
 * size efficiently without loading entire buffers into memory.
 */

const crypto = require("crypto");
const fs     = require("fs");

/**
 * Compute the SHA-256 hex digest of a file via streaming.
 *
 * @param {string} filePath - Absolute path to the file on disk.
 * @returns {Promise<string>} 64-character lowercase hex SHA-256 digest.
 */
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex").toLowerCase());
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}

module.exports = { computeFileHash };
