import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const PHASE7_CONTRACTS = [
  "AIBOMRegistry",
  "RiskManagementSystem",
  "HumanOversightRegistry",
  "IncidentRegistry",
  "ConformityAssessment",
  "DataGovernanceRegistry",
  "QualityManagementSystem",
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  AgentAudit — Phase 7 Deployment`);
  console.log(`  Network : ${networkName} (chainId ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`${"─".repeat(60)}\n`);

  const addresses: Record<string, string> = {};

  for (const name of PHASE7_CONTRACTS) {
    process.stdout.write(`  Deploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    addresses[name] = addr;
    console.log(` ✓  ${addr}`);
  }

  // ── Write deployment record ──────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const record = {
    network: networkName,
    chainId: chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: addresses,
  };

  const outPath = path.join(deploymentsDir, `phase7-${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Deployment complete — ${PHASE7_CONTRACTS.length} contracts`);
  console.log(`  Saved to: deployments/phase7-${networkName}.json`);
  console.log(`${"─".repeat(60)}`);
  console.log(`\n  Contract addresses:`);
  for (const [name, addr] of Object.entries(addresses)) {
    console.log(`    ${name.padEnd(28)} ${addr}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
