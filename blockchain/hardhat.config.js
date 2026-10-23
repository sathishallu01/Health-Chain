"use strict";

require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

// Load environment variables from the project root .env file.
// Only relevant when deploying to an external network (ganache / testnet).
// Tests run on the built-in Hardhat network and do not need any env vars.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // ── Hardhat built-in node ──────────────────────────────────────────────
    // Accounts are auto-generated with 10 000 ETH each.
    // Start with: npx hardhat node
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // ── Local Ganache ──────────────────────────────────────────────────────
    // Requires GANACHE_RPC_URL and DEPLOYER_PRIVATE_KEY in .env
    // Start Ganache, then: npx hardhat run scripts/deploy.js --network ganache
    ganache: {
      url:     process.env.GANACHE_RPC_URL || "http://127.0.0.1:8545",
      chainId: 1337,
      // Use the private key from .env when available (recommended for CI).
      // Falls back to Ganache's own unlocked accounts for local development
      // so no private key needs to be stored in .env during dev.
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : "remote",
    },
  },
};
