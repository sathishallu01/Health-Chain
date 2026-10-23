"use strict";

/**
 * accessController.js
 *
 * Controller for patient-provider access control backed by the on-chain smart contract:
 *   GET  /api/access/providers  — List registered healthcare providers with live on-chain access status
 *   POST /api/access/grant      — Grant on-chain access to a verified healthcare provider
 *   POST /api/access/revoke     — Revoke on-chain access from a healthcare provider
 *   POST /api/access/verify-wallet — Cryptographically verify provider Ethereum wallet ownership
 */

const { ethers } = require("ethers");
const mongoose = require("mongoose");
const User = require("../models/user");
const blockchainService = require("../services/blockchain/blockchainService");

/**
 * GET /api/access/providers
 * Returns all active healthcare providers with on-chain access status for the authenticated patient.
 */
async function getProviders(req, res) {
  try {
    const providers = await User.find({
      role: { $in: ["doctor", "hospital"] },
      isActive: true,
    })
      .select("name email role specialty organization ethereumAddress isWalletVerified")
      .lean();

    const patientId = req.user.userId.toString();
    const isBcAvailable = blockchainService.isAvailable();

    const results = await Promise.all(
      providers.map(async (provider) => {
        let hasAccess = false;
        if (isBcAvailable && provider.ethereumAddress && provider.isWalletVerified) {
          try {
            hasAccess = await blockchainService.hasAccess(patientId, provider.ethereumAddress);
          } catch (err) {
            console.warn(`[accessController] hasAccess check failed for ${provider.name}:`, err.message);
            hasAccess = false;
          }
        }

        return {
          id: provider._id.toString(),
          name: provider.name,
          email: provider.email,
          role: provider.role,
          specialty: provider.specialty || "Healthcare Provider",
          organization: provider.organization || "Medical Center",
          ethereumAddress: provider.ethereumAddress || null,
          isWalletVerified: Boolean(provider.isWalletVerified),
          access: hasAccess,
        };
      })
    );

    return res.status(200).json({
      success: true,
      providers: results,
      count: results.length,
    });
  } catch (err) {
    console.error("[accessController] getProviders error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve provider list.",
    });
  }
}

/**
 * POST /api/access/grant
 * Grant a provider on-chain access to the authenticated patient's records.
 */
async function grantAccess(req, res) {
  const { providerId } = req.body;

  if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
    return res.status(400).json({
      success: false,
      message: "A valid providerId is required.",
    });
  }

  try {
    const provider = await User.findOne({
      _id: providerId,
      role: { $in: ["doctor", "hospital"] },
      isActive: true,
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Healthcare provider not found.",
      });
    }

    if (!provider.ethereumAddress || !ethers.isAddress(provider.ethereumAddress)) {
      return res.status(400).json({
        success: false,
        message: "Provider does not have a valid Ethereum wallet address assigned.",
      });
    }

    if (!provider.isWalletVerified) {
      return res.status(400).json({
        success: false,
        message: "Provider wallet address has not been cryptographically verified.",
      });
    }

    const patientId = req.user.userId.toString();

    // 1. Submit on-chain grantAccess transaction
    const { txHash, blockNumber } = await blockchainService.grantAccess(
      patientId,
      provider.ethereumAddress
    );

    // 2. Verify final on-chain permission (Requirement 4)
    const isConfirmed = await blockchainService.hasAccess(patientId, provider.ethereumAddress);
    if (!isConfirmed) {
      return res.status(500).json({
        success: false,
        message: "Access grant transaction confirmed, but final on-chain permission check failed.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Access granted to ${provider.name} on the blockchain.`,
      txHash,
      blockNumber,
      access: true,
    });
  } catch (err) {
    console.error("[accessController] grantAccess error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to grant access on blockchain.",
    });
  }
}

/**
 * POST /api/access/revoke
 * Revoke a provider's on-chain access to the authenticated patient's records.
 */
async function revokeAccess(req, res) {
  const { providerId } = req.body;

  if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
    return res.status(400).json({
      success: false,
      message: "A valid providerId is required.",
    });
  }

  try {
    const provider = await User.findOne({
      _id: providerId,
      role: { $in: ["doctor", "hospital"] },
      isActive: true,
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Healthcare provider not found.",
      });
    }

    if (!provider.ethereumAddress || !ethers.isAddress(provider.ethereumAddress)) {
      return res.status(400).json({
        success: false,
        message: "Provider does not have a valid Ethereum wallet address.",
      });
    }

    const patientId = req.user.userId.toString();

    // 1. Submit on-chain revokeAccess transaction
    const { txHash, blockNumber } = await blockchainService.revokeAccess(
      patientId,
      provider.ethereumAddress
    );

    // 2. Verify final on-chain permission (Requirement 4)
    const isStillActive = await blockchainService.hasAccess(patientId, provider.ethereumAddress);
    if (isStillActive) {
      return res.status(500).json({
        success: false,
        message: "Access revocation transaction confirmed, but on-chain access is still active.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Access revoked for ${provider.name} on the blockchain.`,
      txHash,
      blockNumber,
      access: false,
    });
  } catch (err) {
    console.error("[accessController] revokeAccess error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to revoke access on blockchain.",
    });
  }
}

/**
 * POST /api/access/verify-wallet
 * Cryptographically verifies ownership of an Ethereum wallet address using an EIP-191 signature.
 * Prevents arbitrary unverified wallet assignments in MongoDB.
 */
async function verifyProviderWallet(req, res) {
  const { message, signature, address } = req.body;

  if (!message || !signature || !address) {
    return res.status(400).json({
      success: false,
      message: "Message, signature, and address are required.",
    });
  }

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Ethereum address format.",
    });
  }

  try {
    // Challenge must include the provider's user ID to prevent signature replay attacks
    const userId = req.user.userId.toString();
    if (!message.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "Verification challenge must contain the authenticated provider's user ID.",
      });
    }

    // Cryptographic recovery: derive signer address from message and signature
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Cryptographic signature does not match the claimed Ethereum address.",
      });
    }

    // Update user record with verified wallet
    const updated = await User.findByIdAndUpdate(
      req.user.userId,
      {
        ethereumAddress: recoveredAddress.toLowerCase(),
        isWalletVerified: true,
      },
      { returnDocument: "after" }
    );

    return res.status(200).json({
      success: true,
      message: "Provider wallet address verified successfully.",
      ethereumAddress: updated.ethereumAddress,
      isWalletVerified: true,
    });
  } catch (err) {
    console.error("[accessController] verifyProviderWallet error:", err.message);
    return res.status(400).json({
      success: false,
      message: `Wallet verification failed: ${err.message}`,
    });
  }
}

module.exports = {
  getProviders,
  grantAccess,
  revokeAccess,
  verifyProviderWallet,
};
