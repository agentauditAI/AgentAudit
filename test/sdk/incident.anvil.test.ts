// Integration: AgentAudit incident methods → real IncidentRegistry v2 on anvil.
// Every field written by reportIncident / markReportedToAuthority is read back
// through the contract ABI from out/ (not the SDK's own ABI).
// Requires Foundry (`anvil`) and a `forge build` artifact in out/; fails without
// them unless AGENTAUDIT_SKIP_ANVIL=1 is set.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { AgentAudit } from "../../sdk/src/index";

// ─── Environment ─────────────────────────────────────────────────────────────

// anvil default accounts #0 / #1 — public test keys, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const AUTHORITY = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ARTIFACT = path.join(__dirname, "../../out/IncidentRegistry.sol/IncidentRegistry.json");
const VAULT_ARTIFACT = path.join(__dirname, "../../out/AuditVault.sol/AuditVault.json");
const PORT = 17545 + (process.pid % 1000);
const RPC = `http://127.0.0.1:${PORT}`;

function hasAnvil(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Missing anvil fails the suite; opt out explicitly with AGENTAUDIT_SKIP_ANVIL=1
const SKIP_ANVIL = process.env.AGENTAUDIT_SKIP_ANVIL === "1";
const describeAnvil = SKIP_ANVIL ? describe.skip : describe;
if (SKIP_ANVIL) console.warn("[incident.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

// ─── Suite ───────────────────────────────────────────────────────────────────

describeAnvil("AgentAudit × IncidentRegistry v2 on anvil", () => {
  let anvil: ChildProcess;
  let provider: ethers.JsonRpcProvider;
  let registry: ethers.Contract;
  let registryAddress: string;
  let vaultAddress: string;
  let sdk: AgentAudit;
  const signer = new ethers.Wallet(KEY).address;

  jest.setTimeout(60_000);

  async function deploy(file: string): Promise<{ address: string; abi: ethers.InterfaceAbi }> {
    const artifact = JSON.parse(readFileSync(file, "utf8"));
    const deployer = new ethers.Wallet(KEY, provider);
    const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer).deploy();
    await deployed.waitForDeployment();
    return { address: await deployed.getAddress(), abi: artifact.abi };
  }

  beforeAll(async () => {
    if (!hasAnvil()) {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    for (const f of [ARTIFACT, VAULT_ARTIFACT]) {
      if (!existsSync(f)) throw new Error(`Missing ${f} — run \`forge build\` first`);
    }

    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
    for (let i = 0; ; i++) {
      try {
        await provider.getBlockNumber();
        break;
      } catch {
        if (i > 100) throw new Error("anvil did not start");
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const reg = await deploy(ARTIFACT);
    registryAddress = reg.address;
    registry = new ethers.Contract(registryAddress, reg.abi, provider);
    vaultAddress = (await deploy(VAULT_ARTIFACT)).address;

    sdk = new AgentAudit({ privateKey: KEY, network: "base", rpcUrl: RPC, incidentRegistryAddress: registryAddress });
  });

  afterAll(async () => {
    provider?.destroy();
    anvil?.kill();
  });

  it("reportIncident writes all seven fields; contract read-back and getIncident agree", async () => {
    const occurredAt = (await provider.getBlock("latest"))!.timestamp - 3600;
    const res = await sdk.reportIncident({
      agentId: 7,
      severity: "HIGH",
      harmType: "FUNDAMENTAL_RIGHTS_VIOLATION",
      affectedPersons: 12,
      description: "credit model denied applicants by postcode",
      evidenceHash: "ipfs://bafyevidence",
      occurredAt,
    });
    expect(res.incidentId).toBe(1);
    expect((await provider.getTransactionReceipt(res.txHash))!.status).toBe(1);

    const raw = await registry.incidents(1);
    expect(raw.agentId).toBe(ethers.id("7"));
    expect(Number(raw.severity)).toBe(2);   // HIGH
    expect(Number(raw.harmType)).toBe(3);   // FUNDAMENTAL_RIGHTS_VIOLATION
    expect(Number(raw.status)).toBe(0);     // OPEN
    expect(raw.description).toBe("credit model denied applicants by postcode");
    expect(raw.evidenceHash).toBe("ipfs://bafyevidence");
    expect(raw.affectedPersons).toBe(12n);
    expect(raw.reportedBy).toBe(signer);
    expect(Number(raw.occurredAt)).toBe(occurredAt);

    expect(await sdk.getIncident(1)).toMatchObject({
      id: 1,
      agentId: ethers.id("7"),
      severity: "HIGH",
      harmType: "FUNDAMENTAL_RIGHTS_VIOLATION",
      status: "OPEN",
      description: "credit model denied applicants by postcode",
      evidenceHash: "ipfs://bafyevidence",
      affectedPersons: 12n,
      reportedBy: signer,
      occurredAt,
      reportedToAuthorityAt: 0,
      authorityAddress: ethers.ZeroAddress,
      withinDeadline: false,
    });
    expect(await sdk.getAgentIncidents(7)).toEqual([1]);
    expect(await sdk.isWithinDeadline(1)).toBe(true);
  });

  it("defaults: OTHER harm, 0 persons, keccak256(description) evidence, block-time occurredAt", async () => {
    const res = await sdk.reportIncident({ agentId: "0x" + "ab".repeat(32), severity: "LOW", description: "minor glitch" });
    const inc = await sdk.getIncident(res.incidentId);
    expect(inc).toMatchObject({
      agentId: "0x" + "ab".repeat(32),
      severity: "LOW",
      harmType: "OTHER",
      affectedPersons: 0n,
      evidenceHash: ethers.keccak256(ethers.toUtf8Bytes("minor glitch")),
    });
    expect(inc.occurredAt).toBeLessThanOrEqual(inc.registeredAt);
  });

  it("markReportedToAuthority records authority, ref and withinDeadline", async () => {
    const res = await sdk.markReportedToAuthority(1, { authority: AUTHORITY, authorityRef: "MSA-2026-0042" });
    expect(res.withinDeadline).toBe(true);
    expect(await sdk.getIncident(1)).toMatchObject({
      status: "REPORTED",
      authorityAddress: AUTHORITY,
      authorityRef: "MSA-2026-0042",
      withinDeadline: true,
    });
  });

  it("CRITICAL incident reported after its 2-day deadline records withinDeadline: false", async () => {
    const now = (await provider.getBlock("latest"))!.timestamp;
    const { incidentId } = await sdk.reportIncident({
      agentId: 7, severity: "CRITICAL", harmType: "DEATH", affectedPersons: 1, description: "late", occurredAt: now - 3 * 86400,
    });
    expect(await sdk.isWithinDeadline(incidentId)).toBe(false);
    expect((await sdk.markReportedToAuthority(incidentId, { authority: AUTHORITY, authorityRef: "late" })).withinDeadline).toBe(false);
  });

  it("only the reporter (or deployer) can mark an incident reported", async () => {
    const { incidentId } = await sdk.reportIncident({ agentId: 7, severity: "MEDIUM", description: "x" });
    const other = new AgentAudit({ privateKey: OTHER_KEY, network: "base", rpcUrl: RPC, incidentRegistryAddress: registryAddress });
    await expect(other.markReportedToAuthority(incidentId, { authority: AUTHORITY, authorityRef: "r" })).rejects.toThrow();
    expect((await sdk.getIncident(incidentId)).status).toBe("OPEN");
  });

  it("getIncident throws for an unknown id", async () => {
    await expect(sdk.getIncident(999)).rejects.toThrow("Incident 999 not found");
  });

  it("refuses a contract that is not IncidentRegistry v2 (AuditVault) without sending a tx", async () => {
    const wrong = new AgentAudit({ privateKey: KEY, network: "base", rpcUrl: RPC, incidentRegistryAddress: vaultAddress });
    const nonce = await provider.getTransactionCount(signer);
    await expect(wrong.reportIncident({ agentId: 7, severity: "LOW", description: "x" })).rejects.toThrow(
      `IncidentRegistry v2 is not available on Base Mainnet: ${vaultAddress} does not implement registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256)`
    );
    expect(await provider.getTransactionCount(signer)).toBe(nonce);
  });

  it("refuses the network default when nothing is deployed there (base address on anvil)", async () => {
    const dflt = new AgentAudit({ privateKey: KEY, network: "base", rpcUrl: RPC });
    await expect(dflt.reportIncident({ agentId: 7, severity: "LOW", description: "x" })).rejects.toThrow(
      "IncidentRegistry v2 is not available on Base Mainnet: 0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F has no contract code"
    );
  });
});
