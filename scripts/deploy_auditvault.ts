import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  AgentAudit — AuditVault Deployment`);
  console.log(`  Network : ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`${"─".repeat(60)}\n`);

  process.stdout.write("  Deploying AuditVault...");
  const Factory = await ethers.getContractFactory("contracts/v2/AuditVault.sol:AuditVault");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(` ✓  ${address}`);

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const record = {
    network: network.name,
    chainId: chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: { AuditVault: address },
  };

  const outPath = path.join(deploymentsDir, `auditvault-${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  AuditVault : ${address}`);
  console.log(`  Saved to   : deployments/auditvault-${network.name}.json`);
  console.log(`${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
