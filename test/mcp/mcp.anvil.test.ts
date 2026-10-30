// Integration: every MCP tool in src/mcp-server.ts against real AuditVault v2 +
// Phase 7 contracts on anvil, including the "no code" and "no event" failures.
// Requires Foundry (`anvil`) and a `forge build` artifact in out/; fails without
// them unless AGENTAUDIT_SKIP_ANVIL=1 is set.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type McpServerOptions } from "../../src/mcp-server";
import { EthersChainReader, verifyBundle } from "../../tools/verify/src/verify";
import { NETWORKS as SDK_NETWORKS } from "../../sdk/src/index";

// ─── Environment ─────────────────────────────────────────────────────────────

// anvil default account #0 — public test key, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PORT = 19545 + (process.pid % 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "../..");
const AGENT_B32 = "0x" + "ab".repeat(32);
const NETS = ["mantle", "base", "arbitrum", "optimism", "polygon"] as const;
const ALL_RPC = Object.fromEntries(NETS.map((n) => [n, RPC]));

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
if (SKIP_ANVIL) console.warn("[mcp.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

function artifact(name: string) {
  const file = path.join(ROOT, `out/${name}.sol/${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing ${file} — run \`forge build\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

interface ToolResult {
  isError: boolean;
  text: string;
}

async function connect(options: McpServerOptions): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(options).connect(serverSide);
  const client = new Client({ name: "mcp-anvil-test", version: "0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: (r.content as { text: string }[]).map((c) => c.text).join("\n") };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describeAnvil("MCP server × AuditVault v2 + Phase 7 on anvil", () => {
  let anvil: ChildProcess;
  let provider: ethers.JsonRpcProvider;
  let deployer: ethers.Wallet;
  let vault: ethers.Contract;
  let vaultAddr: string;
  let incidents: ethers.Contract;
  let phase7Base: Record<string, string>;
  let stopAddr: string;
  let client: Client;

  jest.setTimeout(120_000);

  async function deploy(name: string): Promise<ethers.Contract> {
    const a = artifact(name);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode.object, deployer).deploy();
    await c.waitForDeployment();
    return new ethers.Contract(await c.getAddress(), a.abi, deployer);
  }

  const nonce = () => provider.getTransactionCount(deployer.address);

  beforeAll(async () => {
    if (!hasAnvil()) {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    // cacheTimeout -1: the tools send txs from the same key between our reads
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
    deployer = new ethers.Wallet(KEY, provider);

    vault = await deploy("AuditVault");
    vaultAddr = await vault.getAddress();
    incidents = await deploy("IncidentRegistry");
    const risk = await deploy("RiskManagementSystem");
    const conformity = await deploy("ConformityAssessment");
    phase7Base = {
      IncidentRegistry: await incidents.getAddress(),
      RiskManagementSystem: await risk.getAddress(),
      ConformityAssessment: await conformity.getAddress(),
    };
    await (await risk.claimAgent(AGENT_B32)).wait();
    await (await risk.identifyRisk(AGENT_B32, 0, "biased ranking", "ipfs://risk")).wait();

    // A contract that accepts any call and emits nothing (bytecode: STOP)
    stopAddr = ethers.getAddress("0x" + "5e".repeat(20));
    await provider.send("anvil_setCode", [stopAddr, "0x00"]);

    // mantle/arbitrum/optimism/polygon keep their default (mainnet) addresses,
    // which have no code on anvil
    client = await connect({ privateKey: KEY, rpcUrls: ALL_RPC, auditVaults: { base: vaultAddr }, phase7: { base: phase7Base } });
  });

  afterAll(async () => {
    await client?.close();
    provider?.destroy();
    anvil?.kill();
  });

  it("lists the seven tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "audit_action", "check_conformity", "get_audit_log", "get_compliance_report",
      "get_risk_score", "report_incident", "verify_proof",
    ]);
  });

  it("descriptions state what is live: logging on Base, incidents on 5 networks", async () => {
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description ?? ""]));
    for (const t of ["audit_action", "get_audit_log", "verify_proof"]) {
      expect(tools[t]).toContain("Live on Base only");
      expect(tools[t]).toContain(SDK_NETWORKS.base.auditVault);
    }
    expect(tools.report_incident).toContain("Live on mantle, base, arbitrum, optimism, polygon");
  });

  // ─── audit_action ──────────────────────────────────────────────────────────

  describe("audit_action", () => {
    const ENTRIES = [
      { action_type: "LLM_DECISION", payload: "approve loan #1 — secret-raw-text", timestamp_ms: 1761264000000 },
      { action_type: "TOOL_CALL", payload: { tool: "web_search", q: "x" }, risk_level: "LOW", timestamp_ms: 1761264000001 },
      { action_type: "TRANSFER", payload: "500 USDC", timestamp_ms: 1761264000002 },
    ];
    let out: any;

    beforeAll(async () => {
      // network omitted → defaults to base
      const r = await call(client, "audit_action", { agent_id: 7, entries: ENTRIES });
      expect(r.isError).toBe(false);
      out = JSON.parse(r.text);
    });

    it("commits all entries in one batch on base and returns txHash, batchIndex, merkle_root", async () => {
      expect(out.network).toBe("base");
      expect(out.vault).toBe(vaultAddr);
      expect(out.agent_address).toBe(deployer.address);
      expect(out.batchIndex).toBe(0);
      expect(out.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(Number(await vault.getBatchCount(deployer.address))).toBe(1);
      const onChain = await vault.getBatch(deployer.address, 0);
      expect(onChain.merkleRoot).toBe(out.merkle_root);
      expect(onChain.eventCount).toBe(3n);
      expect((await provider.getTransactionReceipt(out.txHash))!.status).toBe(1);
    });

    it("every returned action_ref + proof verifies on-chain", async () => {
      expect(out.entries).toHaveLength(3);
      for (const e of out.entries) {
        expect(await vault.verifyLog(deployer.address, out.batchIndex, e.action_ref, e.proof)).toBe(true);
      }
    });

    it("records only hashes: raw payloads are not in the result; scope is agent_action:mcp", () => {
      expect(out.entries[0].preimage).toEqual({
        action_type: "LLM_DECISION",
        agent_id: "7",
        scope: expect.stringMatching(/^agent_action:mcp:record_hash:[0-9a-f]{64}$/),
        timestamp_ms: 1761264000000,
      });
      expect(out.entries[0].record).toMatchObject({ plugin: "agentaudit-mcp/2.0", risk_level: "HIGH", payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
      expect(out.entries[1].record.risk_level).toBe("LOW");
      expect(JSON.stringify(out)).not.toContain("secret-raw-text");
      expect(JSON.stringify(out)).not.toContain("web_search");
    });

    it("the returned evidence bundle passes tools/verify end to end", async () => {
      const reader = new EthersChainReader(RPC);
      try {
        const bundle = { ...out.evidence, meta: { anchor: { ...out.evidence.meta.anchor, chain: "anvil" } } };
        const res = await verifyBundle(bundle, { reader, vault: vaultAddr, submitter: deployer.address });
        expect(res.checks.filter((c) => c.status === "FAIL")).toEqual([]);
        expect(res.ok).toBe(true);
      } finally {
        reader.destroy();
      }
    });

    it("does not buffer across calls: the next call commits its own batch immediately", async () => {
      const r = await call(client, "audit_action", { agent_id: "agent-x", entries: [{ action_type: "A", payload: "p" }], network: "base" });
      const next = JSON.parse(r.text);
      expect(next.batchIndex).toBe(1);
      expect(next.entries[0].proof).toEqual([]);
      expect(next.merkle_root).toBe(next.entries[0].action_ref);
      expect(Number(await vault.getBatchCount(deployer.address))).toBe(2);
    });

    it("commits under an explicit agent_address", async () => {
      const agent = ethers.Wallet.createRandom().address;
      const r = await call(client, "audit_action", { agent_id: 1, agent_address: agent, entries: [{ action_type: "A", payload: "p" }] });
      expect(JSON.parse(r.text).agent_address).toBe(agent);
      expect(Number(await vault.getBatchCount(agent))).toBe(1);
    });

    it.each([
      ["mantle", "is AuditVault v1"],
      ["arbitrum", "is not AuditVault v2"],
      ["optimism", "is not AuditVault v2"],
      ["polygon", "is not AuditVault v2"],
    ])("%s without an AuditVault v2 returns a clear error and sends nothing", async (network, what) => {
      const before = await nonce();
      const r = await call(client, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "p" }], network });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(`Audit logging is live on Base only: ${network} has no AuditVault v2`);
      expect(r.text).toContain(what);
      expect(r.text).toContain(`AUDIT_VAULT_${network.toUpperCase()}`);
      expect(await nonce()).toBe(before);
    });

    it("works on another network when an AuditVault v2 override is configured", async () => {
      const c = await connect({ privateKey: KEY, rpcUrls: ALL_RPC, auditVaults: { polygon: vaultAddr } });
      try {
        const r = await call(c, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "q" }], network: "polygon" });
        expect(r.isError).toBe(false);
        expect(JSON.parse(r.text)).toMatchObject({ network: "polygon", vault: vaultAddr });
      } finally {
        await c.close();
      }
    });

    it("no code at the vault: names network + address, sends nothing", async () => {
      // No override: the SDK's base default has no code on anvil
      const c = await connect({ privateKey: KEY, rpcUrls: ALL_RPC });
      try {
        const before = await nonce();
        const r = await call(c, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "p" }] });
        expect(r.isError).toBe(true);
        expect(r.text).toContain(`AuditVault v2 has no contract code on base at ${SDK_NETWORKS.base.auditVault}`);
        expect(await nonce()).toBe(before);
      } finally {
        await c.close();
      }
    });

    it("no LogBatchCommitted event: returns an error, never success", async () => {
      const c = await connect({ privateKey: KEY, rpcUrls: ALL_RPC, auditVaults: { base: stopAddr } });
      try {
        const r = await call(c, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "p" }] });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/commitBatch tx 0x[0-9a-f]{64} mined on base but emitted no LogBatchCommitted/);
      } finally {
        await c.close();
      }
    });

    it("missing PRIVATE_KEY is an error", async () => {
      const c = await connect({ rpcUrls: ALL_RPC, auditVaults: { base: vaultAddr } });
      try {
        const r = await call(c, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "p" }] });
        expect(r.isError).toBe(true);
        expect(r.text).toContain("PRIVATE_KEY env var not set");
      } finally {
        await c.close();
      }
    });

    it("rejects an empty entries list", async () => {
      const r = await call(client, "audit_action", { agent_id: 1, entries: [] });
      expect(r.isError).toBe(true);
    });
  });

  // ─── get_audit_log ─────────────────────────────────────────────────────────

  describe("get_audit_log", () => {
    let committed: any;

    beforeAll(async () => {
      const agent = ethers.Wallet.createRandom().address;
      const r = await call(client, "audit_action", {
        agent_id: 9, agent_address: agent, compliance_score: 88,
        entries: [{ action_type: "A", payload: "1" }, { action_type: "B", payload: "2" }],
      });
      committed = JSON.parse(r.text);
    });

    it("by tx_hash returns the committed batch", async () => {
      const r = await call(client, "get_audit_log", { tx_hash: committed.txHash });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.network).toBe("base");
      expect(out.batches).toEqual([expect.objectContaining({
        agent_address: committed.agent_address,
        batch_index: 0,
        merkle_root: committed.merkle_root,
        contentURI: committed.contentURI,
        event_count: 2,
        compliance_score: 88,
        submitter: deployer.address,
        tx_hash: committed.txHash,
      })]);
    });

    it("by agent_address + batch_index returns the same batch", async () => {
      const r = await call(client, "get_audit_log", { agent_address: committed.agent_address, batch_index: 0 });
      expect(JSON.parse(r.text).batches[0]).toMatchObject({ merkle_root: committed.merkle_root, event_count: 2 });
    });

    it("unknown batch_index is a clear error", async () => {
      const r = await call(client, "get_audit_log", { agent_address: committed.agent_address, batch_index: 5 });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(`Batch 5 not found for ${committed.agent_address} on base (agent has 1 batch)`);
    });

    it("unknown tx_hash is a clear error", async () => {
      const r = await call(client, "get_audit_log", { tx_hash: "0x" + "11".repeat(32) });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("not found on base");
    });

    it("a tx without LogBatchCommitted from the vault is an error", async () => {
      const tx = await deployer.sendTransaction({ to: deployer.address, value: 0 });
      await tx.wait();
      const r = await call(client, "get_audit_log", { tx_hash: tx.hash });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(`emitted no LogBatchCommitted from ${vaultAddr} on base`);
    });

    it("requires exactly one lookup mode", async () => {
      for (const args of [{}, { tx_hash: committed.txHash, agent_address: committed.agent_address, batch_index: 0 }, { batch_index: 0 }]) {
        const r = await call(client, "get_audit_log", args);
        expect(r.isError).toBe(true);
        expect(r.text).toContain("Pass either tx_hash, or agent_address + batch_index");
      }
    });

    it("non-Base network without AuditVault v2 is a clear error", async () => {
      const r = await call(client, "get_audit_log", { tx_hash: committed.txHash, network: "arbitrum" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Audit logging is live on Base only: arbitrum has no AuditVault v2");
    });

    it("no code at the vault names network + address", async () => {
      const c = await connect({ rpcUrls: ALL_RPC });
      try {
        const r = await call(c, "get_audit_log", { tx_hash: committed.txHash });
        expect(r.isError).toBe(true);
        expect(r.text).toContain(`AuditVault v2 has no contract code on base at ${SDK_NETWORKS.base.auditVault}`);
      } finally {
        await c.close();
      }
    });
  });

  // ─── verify_proof ──────────────────────────────────────────────────────────

  describe("verify_proof", () => {
    let committed: any;

    beforeAll(async () => {
      const r = await call(client, "audit_action", {
        agent_id: "v", agent_address: ethers.Wallet.createRandom().address,
        entries: [1, 2, 3, 4, 5].map((i) => ({ action_type: "A", payload: String(i), timestamp_ms: 1761264000000 + i })),
      });
      committed = JSON.parse(r.text);
    });

    const args = (i: number, extra: Record<string, unknown> = {}) => ({
      agent_address: committed.agent_address,
      batch_index: committed.batchIndex,
      entry: { preimage: committed.entries[i].preimage, action_ref: committed.entries[i].action_ref },
      proof: committed.entries[i].proof,
      ...extra,
    });

    it("every entry from audit_action verifies; submitter reported", async () => {
      for (let i = 0; i < 5; i++) {
        const out = JSON.parse((await call(client, "verify_proof", args(i))).text);
        expect(out).toMatchObject({ valid: true, leaf: committed.entries[i].action_ref, submitter: deployer.address });
        expect(out.checks).toEqual({ action_ref_matches: true, verify_log: true });
      }
    });

    it("expected_submitter: match passes, mismatch fails", async () => {
      const ok = JSON.parse((await call(client, "verify_proof", args(0, { expected_submitter: deployer.address }))).text);
      expect(ok.valid).toBe(true);
      const other = ethers.Wallet.createRandom().address;
      const bad = JSON.parse((await call(client, "verify_proof", args(0, { expected_submitter: other }))).text);
      expect(bad.valid).toBe(false);
      expect(bad.checks.submitter_matches).toBe(false);
    });

    it("tampered preimage fails: the leaf is recomputed, never trusted", async () => {
      const preimage = { ...committed.entries[0].preimage, scope: committed.entries[0].preimage.scope.replace(/.$/, "0") };
      const out = JSON.parse((await call(client, "verify_proof", { ...args(0), entry: { preimage, action_ref: committed.entries[0].action_ref } })).text);
      expect(out.valid).toBe(false);
      expect(out.checks).toEqual({ action_ref_matches: false, verify_log: false });
    });

    it("wrong proof fails", async () => {
      const out = JSON.parse((await call(client, "verify_proof", args(0, { proof: committed.entries[1].proof }))).text);
      expect(out.valid).toBe(false);
      expect(out.reasons).toContain("AuditVault.verifyLog returned false");
    });

    it("entry from another batch fails against this batch", async () => {
      const out = JSON.parse((await call(client, "verify_proof", { ...args(0), agent_address: deployer.address, batch_index: 0 })).text);
      expect(out.valid).toBe(false);
    });

    it("invalid preimage and unknown batch are errors", async () => {
      const bad = await call(client, "verify_proof", { ...args(0), entry: { preimage: { ...committed.entries[0].preimage, extra: 1 } } });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("Invalid preimage: preimage has non-schema field(s): extra");
      const missing = await call(client, "verify_proof", args(0, { batch_index: 3 }));
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain("Batch 3 not found");
    });

    it("non-Base network and no-code vault are clear errors", async () => {
      const r = await call(client, "verify_proof", args(0, { network: "mantle" }));
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Audit logging is live on Base only: mantle has no AuditVault v2");
      const c = await connect({ rpcUrls: ALL_RPC });
      try {
        const r2 = await call(c, "verify_proof", args(0));
        expect(r2.isError).toBe(true);
        expect(r2.text).toContain(`AuditVault v2 has no contract code on base at ${SDK_NETWORKS.base.auditVault}`);
      } finally {
        await c.close();
      }
    });
  });

  // ─── report_incident ───────────────────────────────────────────────────────

  describe("report_incident", () => {
    const INCIDENT = {
      agent_id: AGENT_B32, severity: "HIGH", harm_type: "OTHER", description: "wrong denial",
      evidence_hash: "ipfs://ev", affected_persons: 3, occurred_at: 1761264000,
    };

    it("registers on IncidentRegistry v2 and reports the IncidentRegistered id", async () => {
      const r = await call(client, "report_incident", { ...INCIDENT, network: "base" });
      expect(r.isError).toBe(false);
      expect(r.text).toContain("Incident ID      : 1");
      const ids = await incidents.getAgentIncidents(AGENT_B32);
      expect(ids.map(Number)).toEqual([1]);
    });

    it("no code at the registry: clear error naming network + address, nothing sent", async () => {
      const before = await nonce();
      const r = await call(client, "report_incident", { ...INCIDENT, network: "mantle" });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/IncidentRegistry has no contract code on mantle at 0x[0-9a-fA-F]{40}/);
      expect(await nonce()).toBe(before);
    });

    it("no IncidentRegistered event: error, never success", async () => {
      const c = await connect({ privateKey: KEY, rpcUrls: ALL_RPC, phase7: { base: { IncidentRegistry: stopAddr } } });
      try {
        const before = await nonce();
        const r = await call(c, "report_incident", { ...INCIDENT, network: "base" });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(new RegExp(`Incident NOT registered: tx 0x[0-9a-f]{64} on base emitted no IncidentRegistered from ${stopAddr}`));
        expect(r.text).not.toContain("Incident ID");
        expect(await nonce()).toBe(before + 1); // the tx was mined — and still not reported as success
      } finally {
        await c.close();
      }
    });

    it("a reverting registerIncident is an error", async () => {
      // agent_id 0x00 pads to bytes32(0) → InvalidAgentId()
      const r = await call(client, "report_incident", { ...INCIDENT, agent_id: "0x00", network: "base" });
      expect(r.isError).toBe(true);
      expect(r.text).not.toContain("Incident ID");
    });
  });

  // ─── Phase 7 reads ─────────────────────────────────────────────────────────

  describe("get_risk_score / check_conformity / get_compliance_report", () => {
    it("get_risk_score reads the deployed RiskManagementSystem", async () => {
      const r = await call(client, "get_risk_score", { agent_id: AGENT_B32, network: "base" });
      expect(r.isError).toBe(false);
      expect(r.text).toContain("Total risks  : 1");
      expect(r.text).toContain("biased ranking");
    });

    it("check_conformity reads the deployed ConformityAssessment", async () => {
      const r = await call(client, "check_conformity", { agent_id: AGENT_B32, network: "base" });
      expect(r.isError).toBe(false);
      expect(r.text).toContain("No conformity record found for this agent.");
    });

    it.each([
      ["get_risk_score", "RiskManagementSystem"],
      ["check_conformity", "ConformityAssessment"],
    ])("%s with no code returns a clear error naming network + address, not BAD_DATA", async (tool, name) => {
      const r = await call(client, tool, { agent_id: AGENT_B32, network: "mantle" });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(new RegExp(`${name} has no contract code on mantle at 0x[0-9a-fA-F]{40}`));
      expect(r.text).not.toContain("BAD_DATA");
    });

    it("get_compliance_report: live sections on base, clear no-code errors on mantle", async () => {
      const base = await call(client, "get_compliance_report", { agent_id: AGENT_B32, network: "base" });
      expect(base.text).toContain("Art. 9   Risk Mgmt     : open=1");
      expect(base.text).toContain("Art. 73  Incidents     : total=1  open=1");
      expect(base.text).toContain("Art. 43/44 Conformity  : NOT REGISTERED");

      const mantle = await call(client, "get_compliance_report", { agent_id: AGENT_B32, network: "mantle" });
      for (const name of ["ConformityAssessment", "RiskManagementSystem", "IncidentRegistry"]) {
        expect(mantle.text).toMatch(new RegExp(`error — ${name} has no contract code on mantle at 0x[0-9a-fA-F]{40}`));
      }
      expect(mantle.text).not.toContain("BAD_DATA");
    });

    it("get_compliance_report all: every network section is present", async () => {
      const r = await call(client, "get_compliance_report", { agent_id: AGENT_B32 });
      for (const n of NETS) expect(r.text).toContain(`── Network: ${n.toUpperCase()}`);
      expect(r.text).not.toContain("BAD_DATA");
    });
  });

  // ─── stdio entry point ─────────────────────────────────────────────────────

  it("stdio entry point: env config (RPC_*, AUDIT_VAULT_BASE, PRIVATE_KEY) drives audit_action", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !/^(RPC_|AUDIT_VAULT_|AUDIT_BATCH_)/.test(k)) env[k] = v;
    }
    for (const n of NETS) env[`RPC_${n.toUpperCase()}`] = RPC;
    env.AUDIT_VAULT_BASE = vaultAddr;
    env.PRIVATE_KEY = KEY;

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["-r", "ts-node/register/transpile-only", "src/mcp-server.ts"],
      cwd: ROOT,
      env,
      stderr: "ignore",
    });
    const c = new Client({ name: "mcp-stdio-test", version: "0" });
    await c.connect(transport);
    try {
      expect((await c.listTools()).tools).toHaveLength(7);
      const r = await call(c, "audit_action", { agent_id: 1, entries: [{ action_type: "A", payload: "stdio" }] });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out).toMatchObject({ network: "base", vault: vaultAddr });
      expect(await vault.verifyLog(deployer.address, out.batchIndex, out.entries[0].action_ref, out.entries[0].proof)).toBe(true);
    } finally {
      await c.close();
    }
  });
});
