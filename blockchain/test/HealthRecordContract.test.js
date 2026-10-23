"use strict";

/**
 * HealthRecordContract — Hardhat / Mocha / Chai test suite
 *
 * All patient IDs and record hashes are synthetic.
 * No real patient data is used anywhere in this file.
 *
 * Coverage:
 *   ✔ Deployment state
 *   ✔ addRecord  — happy path, ordering, isolation, all reverts
 *   ✔ grantAccess — happy path, idempotency, isolation, all reverts
 *   ✔ revokeAccess — happy path, idempotency, re-grant cycle, all reverts
 *   ✔ View functions — defaults for unknown patients
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// ── Test constants ─────────────────────────────────────────────────────────

// Synthetic patient IDs (MongoDB ObjectId format — 24 hex chars)
const PATIENT_A = "507f1f77bcf86cd799439011";
const PATIENT_B = "507f1f77bcf86cd799439012";

// Valid 64-character SHA-256 hex strings used as synthetic record hashes.
// These are real SHA-256 outputs of benign strings — no medical content.
// sha256("synthetic-health-record-alpha")
const HASH_1 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
// sha256("synthetic-health-record-beta")
const HASH_2 =
  "2c624232cdd221771294dfbb310acbc8f69e4e08afe7a01c84d8b6df25e028b5";

// ── Test suite ─────────────────────────────────────────────────────────────

describe("HealthRecordContract", function () {
  let contract;
  let owner;
  let nonOwner;
  let provider1;
  let provider2;

  beforeEach(async function () {
    [owner, nonOwner, provider1, provider2] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("HealthRecordContract");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  // ── 1. Deployment ────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the deployer as immutable owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("starts with zero records for any patient", async function () {
      expect(await contract.getRecordCount(PATIENT_A)).to.equal(0n);
    });

    it("starts with an empty record-hash array for any patient", async function () {
      const hashes = await contract.getRecordHashes(PATIENT_A);
      expect(hashes).to.have.lengthOf(0);
    });

    it("starts with no active access for any provider", async function () {
      expect(
        await contract.hasAccess(PATIENT_A, provider1.address)
      ).to.equal(false);
    });

    it("starts with an empty providers list for any patient", async function () {
      const providers = await contract.getProviders(PATIENT_A);
      expect(providers).to.have.lengthOf(0);
    });
  });

  // ── 2. addRecord ─────────────────────────────────────────────────────────

  describe("addRecord", function () {
    describe("Happy path", function () {
      it("stores the hash and emits RecordAdded with correct args", async function () {
        await expect(contract.addRecord(PATIENT_A, HASH_1))
          .to.emit(contract, "RecordAdded")
          .withArgs(PATIENT_A, HASH_1, anyValue);
      });

      it("increments the record count after each add", async function () {
        await contract.addRecord(PATIENT_A, HASH_1);
        expect(await contract.getRecordCount(PATIENT_A)).to.equal(1n);

        await contract.addRecord(PATIENT_A, HASH_2);
        expect(await contract.getRecordCount(PATIENT_A)).to.equal(2n);
      });

      it("stores multiple hashes in insertion order", async function () {
        await contract.addRecord(PATIENT_A, HASH_1);
        await contract.addRecord(PATIENT_A, HASH_2);

        const hashes = await contract.getRecordHashes(PATIENT_A);
        expect(hashes).to.have.lengthOf(2);
        expect(hashes[0]).to.equal(HASH_1);
        expect(hashes[1]).to.equal(HASH_2);
      });

      it("keeps record lists completely isolated between patients", async function () {
        await contract.addRecord(PATIENT_A, HASH_1);
        await contract.addRecord(PATIENT_B, HASH_2);

        const hashesA = await contract.getRecordHashes(PATIENT_A);
        const hashesB = await contract.getRecordHashes(PATIENT_B);

        expect(hashesA).to.have.lengthOf(1);
        expect(hashesB).to.have.lengthOf(1);
        expect(hashesA[0]).to.equal(HASH_1);
        expect(hashesB[0]).to.equal(HASH_2);
      });

      it("allows the same hash to be registered more than once (upload replay)", async function () {
        await contract.addRecord(PATIENT_A, HASH_1);
        await contract.addRecord(PATIENT_A, HASH_1);
        expect(await contract.getRecordCount(PATIENT_A)).to.equal(2n);
      });
    });

    describe("Access control & validation", function () {
      it("reverts when called by a non-owner", async function () {
        await expect(
          contract.connect(nonOwner).addRecord(PATIENT_A, HASH_1)
        ).to.be.revertedWith("Caller is not the contract owner");
      });

      it("reverts on an empty patient ID", async function () {
        await expect(contract.addRecord("", HASH_1)).to.be.revertedWith(
          "Patient ID must not be empty"
        );
      });

      it("reverts when hash is shorter than 64 characters", async function () {
        await expect(
          contract.addRecord(PATIENT_A, "deadbeef")
        ).to.be.revertedWith(
          "Hash must be a 64-character SHA-256 hex string"
        );
      });

      it("reverts when hash is longer than 64 characters", async function () {
        const tooLong = HASH_1 + "00"; // 66 chars
        await expect(
          contract.addRecord(PATIENT_A, tooLong)
        ).to.be.revertedWith(
          "Hash must be a 64-character SHA-256 hex string"
        );
      });
    });
  });

  // ── 3. grantAccess ───────────────────────────────────────────────────────

  describe("grantAccess", function () {
    describe("Happy path", function () {
      it("grants access and emits AccessGranted with correct args", async function () {
        await expect(
          contract.grantAccess(PATIENT_A, provider1.address)
        )
          .to.emit(contract, "AccessGranted")
          .withArgs(PATIENT_A, provider1.address, anyValue);
      });

      it("hasAccess returns true after a grant", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        expect(
          await contract.hasAccess(PATIENT_A, provider1.address)
        ).to.equal(true);
      });

      it("is idempotent — does not emit a second AccessGranted", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        await expect(
          contract.grantAccess(PATIENT_A, provider1.address)
        ).to.not.emit(contract, "AccessGranted");
      });

      it("tracks multiple unique providers per patient", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        await contract.grantAccess(PATIENT_A, provider2.address);

        const providers = await contract.getProviders(PATIENT_A);
        expect(providers).to.have.lengthOf(2);
        expect(providers).to.include(provider1.address);
        expect(providers).to.include(provider2.address);
      });

      it("isolates access permissions between patients", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        expect(
          await contract.hasAccess(PATIENT_B, provider1.address)
        ).to.equal(false);
      });
    });

    describe("Access control & validation", function () {
      it("reverts when called by a non-owner", async function () {
        await expect(
          contract
            .connect(nonOwner)
            .grantAccess(PATIENT_A, provider1.address)
        ).to.be.revertedWith("Caller is not the contract owner");
      });

      it("reverts on empty patient ID", async function () {
        await expect(
          contract.grantAccess("", provider1.address)
        ).to.be.revertedWith("Patient ID must not be empty");
      });

      it("reverts when provider is the zero address", async function () {
        await expect(
          contract.grantAccess(PATIENT_A, ethers.ZeroAddress)
        ).to.be.revertedWith("Provider address must not be zero");
      });
    });
  });

  // ── 4. revokeAccess ──────────────────────────────────────────────────────

  describe("revokeAccess", function () {
    describe("Happy path", function () {
      it("revokes access and emits AccessRevoked with correct args", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);

        await expect(
          contract.revokeAccess(PATIENT_A, provider1.address)
        )
          .to.emit(contract, "AccessRevoked")
          .withArgs(PATIENT_A, provider1.address, anyValue);
      });

      it("hasAccess returns false after a revoke", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        await contract.revokeAccess(PATIENT_A, provider1.address);

        expect(
          await contract.hasAccess(PATIENT_A, provider1.address)
        ).to.equal(false);
      });

      it("is idempotent — does not emit AccessRevoked when already revoked", async function () {
        // provider2 never received access
        await expect(
          contract.revokeAccess(PATIENT_A, provider2.address)
        ).to.not.emit(contract, "AccessRevoked");
      });

      it("supports the full grant → revoke → re-grant cycle", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        await contract.revokeAccess(PATIENT_A, provider1.address);

        // Re-granting must succeed and emit the event again
        await expect(
          contract.grantAccess(PATIENT_A, provider1.address)
        ).to.emit(contract, "AccessGranted");

        expect(
          await contract.hasAccess(PATIENT_A, provider1.address)
        ).to.equal(true);
      });

      it("does not duplicate a provider in getProviders after revoke + re-grant", async function () {
        await contract.grantAccess(PATIENT_A, provider1.address);
        await contract.revokeAccess(PATIENT_A, provider1.address);
        await contract.grantAccess(PATIENT_A, provider1.address);

        const providers = await contract.getProviders(PATIENT_A);
        expect(providers).to.have.lengthOf(1);
        expect(providers[0]).to.equal(provider1.address);
      });
    });

    describe("Access control & validation", function () {
      it("reverts when called by a non-owner", async function () {
        await expect(
          contract
            .connect(nonOwner)
            .revokeAccess(PATIENT_A, provider1.address)
        ).to.be.revertedWith("Caller is not the contract owner");
      });

      it("reverts on empty patient ID", async function () {
        await expect(
          contract.revokeAccess("", provider1.address)
        ).to.be.revertedWith("Patient ID must not be empty");
      });

      it("reverts when provider is the zero address", async function () {
        await expect(
          contract.revokeAccess(PATIENT_A, ethers.ZeroAddress)
        ).to.be.revertedWith("Provider address must not be zero");
      });
    });
  });

  // ── 5. View functions with unknown patients ───────────────────────────────

  describe("View functions — unknown patient defaults", function () {
    const UNKNOWN = "aaaaaaaaaaaaaaaaaaaaaaaa"; // 24 chars, never used

    it("getRecordCount returns 0 for unknown patient", async function () {
      expect(await contract.getRecordCount(UNKNOWN)).to.equal(0n);
    });

    it("getRecordHashes returns empty array for unknown patient", async function () {
      expect(await contract.getRecordHashes(UNKNOWN)).to.have.lengthOf(0);
    });

    it("hasAccess returns false for unknown patient", async function () {
      expect(
        await contract.hasAccess(UNKNOWN, provider1.address)
      ).to.equal(false);
    });

    it("getProviders returns empty array for unknown patient", async function () {
      expect(await contract.getProviders(UNKNOWN)).to.have.lengthOf(0);
    });
  });

  // ── 6. End-to-end scenario ───────────────────────────────────────────────

  describe("End-to-end scenario", function () {
    it("records a hash, grants a provider, revokes, and verifies audit events", async function () {
      // 1. Register two synthetic records for Patient A
      await contract.addRecord(PATIENT_A, HASH_1);
      await contract.addRecord(PATIENT_A, HASH_2);
      expect(await contract.getRecordCount(PATIENT_A)).to.equal(2n);

      // 2. Grant provider1 access
      await contract.grantAccess(PATIENT_A, provider1.address);
      expect(
        await contract.hasAccess(PATIENT_A, provider1.address)
      ).to.equal(true);

      // 3. Patient B remains unaffected
      expect(await contract.getRecordCount(PATIENT_B)).to.equal(0n);
      expect(
        await contract.hasAccess(PATIENT_B, provider1.address)
      ).to.equal(false);

      // 4. Revoke provider1
      await contract.revokeAccess(PATIENT_A, provider1.address);
      expect(
        await contract.hasAccess(PATIENT_A, provider1.address)
      ).to.equal(false);

      // 5. Provider list still contains the address for audit purposes
      const providers = await contract.getProviders(PATIENT_A);
      expect(providers).to.include(provider1.address);

      // 6. Record hashes remain unchanged after access operations
      const hashes = await contract.getRecordHashes(PATIENT_A);
      expect(hashes[0]).to.equal(HASH_1);
      expect(hashes[1]).to.equal(HASH_2);
    });
  });
});
