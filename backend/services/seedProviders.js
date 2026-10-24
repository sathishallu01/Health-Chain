"use strict";

const User = require("../models/user");

const SEED_PROVIDERS = [
  {
    name: "Dr. Ananya Rao",
    email: "ananya.rao@citycare.invalid",
    role: "doctor",
    specialty: "General Physician",
    organization: "City Care Hospital",
    ethereumAddress: "0xf897c63d17802c0f54875f4f3913dd353c2473e2",
    isWalletVerified: true,
  },
  {
    name: "Dr. Rahul Sharma",
    email: "rahul.sharma@diagnostic.invalid",
    role: "doctor",
    specialty: "Laboratory Specialist",
    organization: "Central Diagnostic Lab",
    ethereumAddress: "0xdcfcce8ed470404320e60022cfa6c63f043bd007",
    isWalletVerified: true,
  },
  {
    name: "Dr. Priya Kumar",
    email: "priya.kumar@greenvalley.invalid",
    role: "doctor",
    specialty: "Cardiologist",
    organization: "Green Valley Clinic",
    ethereumAddress: "0x734c42d658850b32669c0ecd81c750e03547f35f",
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
