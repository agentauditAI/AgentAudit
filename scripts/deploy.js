const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const AuditVault = await ethers.getContractFactory("AuditVault");
  const contract = await AuditVault.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Deployed to:", address);
}

main().catch(console.error);