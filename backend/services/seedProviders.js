"use strict";

const User = require("../models/user");

const SEED_PROVIDERS = [
  {
    name: "Dr. Ananya Rao",
    email: "ananya.rao@citycare.invalid",
    role: "doctor",
    specialty: "General Physician",
    organization: "City Care Hospital",
    ethereumAddress: "0x60D03849cB06Df4046E8B84BD4738F0bfc2a7883",
    isWalletVerified: true,
  },
  {
    name: "Dr. Rahul Sharma",
    email: "rahul.sharma@diagnostic.invalid",
    role: "doctor",
    specialty: "Laboratory Specialist",
    organization: "Central Diagnostic Lab",
    ethereumAddress: "0x0140E191b60Cf4Ae2419659824c0f952987C4164",
    isWalletVerified: true,
  },
  {
    name: "Dr. Priya Kumar",
    email: "priya.kumar@greenvalley.invalid",
    role: "doctor",
    specialty: "Cardiologist",
    organization: "Green Valley Clinic",
    ethereumAddress: "0xcd5BF8fE742B277B51ed9661aA006480F9336eBc",
    isWalletVerified: true,
  },
];

async function seedDemoProviders() {
  for (const prov of SEED_PROVIDERS) {
    const existing = await User.findOne({ email: prov.email });
    if (!existing) {
      await User.create({
        ...prov,
        password: "Password123!",
      });
    } else {
      let updated = false;
      if (existing.ethereumAddress !== prov.ethereumAddress.toLowerCase()) {
        existing.ethereumAddress = prov.ethereumAddress.toLowerCase();
        existing.isWalletVerified = true;
        updated = true;
      }
      if (!existing.specialty) {
        existing.specialty = prov.specialty;
        existing.organization = prov.organization;
        updated = true;
      }
      if (updated) {
        await existing.save();
      }
    }
  }
}

module.exports = { seedDemoProviders, SEED_PROVIDERS };
