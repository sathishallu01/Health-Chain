"use strict";

/**
 * Deploy HealthRecordContract and save the address + ABI to
 * deployments/contract.json so the backend blockchain service can
 * load them at runtime without hard-coding anything.
 *
 * Usage:
 *   # Against Hardhat local node  (start with: npx hardhat node)
 *   npx hardhat run scripts/deploy.js --network localhost
 *
 *   # Against Ganache
 *   npx hardhat run scripts/deploy.js --network ganache
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("─────────────────────────────────────────────");
  console.log("Network       :", hre.network.name);
  console.log("Deployer      :", deployer.address);
  console.log("Balance       :", hre.ethers.formatEther(balance), "ETH");
  console.log("─────────────────────────────────────────────");

  // ── Deploy ──────────────────────────────────────────────────────────────
  console.log("Deploying HealthRecordContract…");
  const Factory  = await hre.ethers.getContractFactory("HealthRecordContract");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("Contract deployed to:", contractAddress);

  // ── Read compiled ABI ───────────────────────────────────────────────────
  const artifact = await hre.artifacts.readArtifact("HealthRecordContract");

  // ── Persist deployment info ─────────────────────────────────────────────
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    address:         contractAddress,
    abi:             artifact.abi,
    network:         hre.network.name,
    chainId:         hre.network.config.chainId ?? null,
    deployedAt:      new Date().toISOString(),
    deployerAddress: deployer.address,
  };

  const outputPath = path.join(deploymentsDir, "contract.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));

  console.log("─────────────────────────────────────────────");
  console.log("Deployment saved →", outputPath);
  console.log("─────────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});