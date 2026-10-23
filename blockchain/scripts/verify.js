const hre = require("hardhat");

async function main() {
  const contractAddress = "0x20121A08738f9f8dB66f2218Fab4B00225bd9F21";

  const contract = await hre.ethers.getContractAt(
    "HealthRecordContract",
    contractAddress
  );

  const message = await contract.message();
  console.log("Contract message:", message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});