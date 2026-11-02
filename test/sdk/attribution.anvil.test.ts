// Integration: Base Builder Code (ERC-8021) suffix against real AuditVault v2 and
// IncidentRegistry v2 on anvil running as chain 8453. Each pair of transactions —
// default attribution vs builderCode: false — is sent from the same evm_snapshot with
// the same block timestamp, so events and state must be identical and the calldata
// must differ only by the trailing suffix. Covers the SDK and the MCP server.
// Requires Foundry (`anvil`) and `forge build` artifacts in out/; fails without them
// unless AGENTAUDIT_SKIP_ANVIL=1 is set.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentAudit, BatchBuffer, MemoryBatchStore, sha256Hex, type ActionPreimage } from "../../sdk/src/index";
import { createServer, type McpServerOptions } from "../../src/mcp-server";

// anvil default account #0 — public test key, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AGENT_B32 = "0x" + "cd".repeat(32);
const PORT = 20545 + (process.pid % 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "../..");
const OUR_SUFFIX = "0x62635f70643638317732350b0080218021802180218021802180218021";
const FIXED_TS = 1_900_000_000;

function hasAnvil(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SKIP_ANVIL = process.env.AGENTAUDIT_SKIP_ANVIL === "1";
const describeAnvil = SKIP_ANVIL ? describe.skip : describe;
if (SKIP_ANVIL) console.warn("[attribution.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

function artifact(name: string) {
  const file = path.join(ROOT, `out/${name}.sol/${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing ${file} — run \`forge build\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** ERC-8021 schema-0 decode, reading from the end of the calldata (independent of the encoder). */
function decodeSuffix(data: string): { codes: string[]; txData: string } | null {
  const b = ethers.getBytes(data);
  const marker = ethers.hexlify(b.slice(b.length - 16));
  if (marker !== "0x80218021802180218021802180218021") return null;
  const schemaId = b[b.length - 17];
  if (schemaId !== 0) return null;
  const len = b[b.length - 18];
  const codesEnd = b.length - 18;
  const codes = ethers.toUtf8String(b.slice(codesEnd - len, codesEnd)).split(",");
  return { codes, txData: ethers.hexlify(b.slice(0, codesEnd - len)) };
}

/** Bundle without created_at_ms: the wall-clock build time, not part of action_ref or the Merkle root. */
const timeless = (bundle: any) => {
  const { created_at_ms, ...rest } = bundle;
  expect(typeof created_at_ms).toBe("number");
  return rest;
};

const strip = (logs: readonly ethers.Log[]) => logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data }));

describeAnvil("Builder Code suffix on anvil (chain 8453)", () => {
  let anvil: ChildProcess;
  let provider: ethers.JsonRpcProvider;
  let vault: ethers.Contract;
  let registry: ethers.Contract;
  let vaultAddr: string;
  let registryAddr: string;

  jest.setTimeout(120_000);

  async function deploy(name: string, signer: ethers.Wallet): Promise<ethers.Contract> {
    const a = artifact(name);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode.object, signer).deploy();
    await c.waitForDeployment();
    return new ethers.Contract(await c.getAddress(), a.abi, provider);
  }

  beforeAll(async () => {
    if (!hasAnvil()) {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "8453", "--silent"], { stdio: "ignore" });
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
    expect((await provider.getNetwork()).chainId).toBe(8453n);
    const deployer = new ethers.Wallet(KEY, provider);
    vault = await deploy("AuditVault", deployer);
    registry = await deploy("IncidentRegistry", deployer);
    vaultAddr = await vault.getAddress();
    registryAddr = await registry.getAddress();
  });

  afterAll(async () => {
    provider?.destroy();
    anvil?.kill();
  });

  /** Runs `fn` from a snapshot (restored afterwards) with a pinned next block timestamp. */
  async function fromSnapshot<T>(fn: () => Promise<T>): Promise<T> {
    const snap = await provider.send("evm_snapshot", []);
    try {
      await provider.send("evm_setNextBlockTimestamp", [FIXED_TS]);
      return await fn();
    } finally {
      await provider.send("evm_revert", [snap]);
    }
  }

  const sdk = (builderCode?: string | false) =>
    new AgentAudit({
      privateKey: KEY,
      network: "base",
      rpcUrl: RPC,
      auditVaultAddress: vaultAddr,
      incidentRegistryAddress: registryAddr,
      ...(builderCode === undefined ? {} : { builderCode }),
    });

  async function txFacts(txHash: string) {
    const tx = (await provider.getTransaction(txHash))!;
    const receipt = (await provider.getTransactionReceipt(txHash))!;
    expect(receipt.status).toBe(1);
    return { data: tx.data, gasLimit: tx.gasLimit, gasUsed: receipt.gasUsed, logs: strip(receipt.logs), blockNumber: receipt.blockNumber };
  }

  const PREIMAGES: ActionPreimage[] = [0, 1, 2].map((i) => ({
    action_type: "LLM_DECISION",
    agent_id: "7",
    scope: `llm_call:m:record_hash:${sha256Hex(String(i))}`,
    timestamp_ms: 1761264000000 + i,
  }));

  async function bufferedCommit(builderCode?: string | false) {
    const s = sdk(builderCode);
    const store = new MemoryBatchStore();
    const buffer = new BatchBuffer({ committer: s, agentAddress: AGENT, store, complianceScore: 90 });
    const refs: string[] = [];
    for (const p of PREIMAGES) refs.push((await buffer.add(p)).actionRef);
    const result = (await buffer.flush())!;
    const bundle = await store.get(result.batchId);
    const batch = await vault.getBatch(AGENT, 0);
    return { result, refs, bundle, batch: batch.toArray(), count: await vault.getBatchCount(AGENT), facts: await txFacts(result.txHash) };
  }

  it("AuditVault v2 commitBatch: same event, state and evidence; calldata differs only by the suffix", async () => {
    const off = await fromSnapshot(() => bufferedCommit(false));
    const on = await fromSnapshot(() => bufferedCommit());

    // calldata: on = off ‖ suffix, and the suffix decodes to our code
    expect(off.facts.data.endsWith("8021".repeat(8))).toBe(false);
    expect(on.facts.data).toBe(off.facts.data + OUR_SUFFIX.slice(2));
    expect(decodeSuffix(on.facts.data)).toEqual({ codes: ["bc_pd681w25"], txData: off.facts.data });

    // identical LogBatchCommitted (address, topics, data) and identical on-chain batch
    expect(on.facts.logs).toEqual(off.facts.logs);
    expect(on.facts.logs).toHaveLength(1);
    expect(on.batch).toEqual(off.batch);
    expect(on.count).toBe(1n);
    expect(on.facts.blockNumber).toBe(off.facts.blockNumber);

    // identical evidence: action_refs, Merkle root, bundle; only the tx hash differs
    expect(on.refs).toEqual(off.refs);
    expect(on.result.merkleRoot).toBe(off.result.merkleRoot);
    expect(timeless(on.bundle)).toEqual(timeless(off.bundle));
    expect(on.result.txHash).not.toBe(off.result.txHash);

    // gas: estimated on the final calldata; the 29-byte suffix costs 28×16 + 1×4 = 452 calldata gas
    expect(on.facts.gasLimit).toBeGreaterThan(off.facts.gasLimit);
    expect(on.facts.gasUsed - off.facts.gasUsed).toBe(452n);
  });

  it("IncidentRegistry v2 registerIncident: same event and record; calldata differs only by the suffix", async () => {
    const report = { agentId: AGENT_B32, severity: "HIGH" as const, description: "wrong denial", affectedPersons: 2, occurredAt: FIXED_TS - 3600 };
    const run = (builderCode?: string | false) => fromSnapshot(async () => {
      const r = await sdk(builderCode).reportIncident(report);
      return { r, facts: await txFacts(r.txHash), record: (await registry.incidents(r.incidentId)).toArray() };
    });
    const off = await run(false);
    const on = await run();

    expect(on.facts.data).toBe(off.facts.data + OUR_SUFFIX.slice(2));
    expect(decodeSuffix(on.facts.data)!.codes).toEqual(["bc_pd681w25"]);
    expect(on.facts.logs).toEqual(off.facts.logs);
    expect(on.r.incidentId).toBe(1);
    expect(on.r.incidentId).toBe(off.r.incidentId);
    expect(on.record).toEqual(off.record);
  });

  it("a custom builderCode is what lands on-chain", async () => {
    const facts = await fromSnapshot(async () => txFacts((await bufferedCommit("myapp")).result.txHash));
    expect(decodeSuffix(facts.data)!.codes).toEqual(["myapp"]);
  });

  describe("MCP server", () => {
    async function mcp(options: Partial<McpServerOptions>): Promise<Client> {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createServer({
        privateKey: KEY,
        rpcUrls: { base: RPC },
        auditVaults: { base: vaultAddr },
        phase7: { base: { IncidentRegistry: registryAddr, RiskManagementSystem: registryAddr, ConformityAssessment: registryAddr } },
        ...options,
      }).connect(serverSide);
      const client = new Client({ name: "attribution-anvil-test", version: "0" });
      await client.connect(clientSide);
      return client;
    }

    async function tool(options: Partial<McpServerOptions>, name: string, args: Record<string, unknown>) {
      const client = await mcp(options);
      try {
        const r = await client.callTool({ name, arguments: args });
        const text = (r.content as { text: string }[]).map((c) => c.text).join("\n");
        expect(r.isError).toBeFalsy();
        return text;
      } finally {
        await client.close();
      }
    }

    const ENTRIES = [{ action_type: "LLM_DECISION", payload: "approve loan #1", timestamp_ms: 1761264000000 }];

    async function auditAction(options: Partial<McpServerOptions>) {
      return fromSnapshot(async () => {
        const out = JSON.parse(await tool(options, "audit_action", { agent_id: "7", entries: ENTRIES, network: "base" }));
        return { out, facts: await txFacts(out.txHash) };
      });
    }

    it("audit_action: default appends bc_pd681w25; builderCode false does not; evidence identical", async () => {
      const off = await auditAction({ builderCode: false });
      const on = await auditAction({});
      expect(on.facts.data).toBe(off.facts.data + OUR_SUFFIX.slice(2));
      expect(on.facts.logs).toEqual(off.facts.logs);
      expect(on.out.merkle_root).toBe(off.out.merkle_root);
      expect(on.out.entries).toEqual(off.out.entries);
      const { meta: onMeta, ...onEvidence } = on.out.evidence;
      const { meta: offMeta, ...offEvidence } = off.out.evidence;
      expect(timeless(onEvidence)).toEqual(timeless(offEvidence));
      expect(onMeta.anchor.rootCommitment).toBe(offMeta.anchor.rootCommitment);
    });

    it("report_incident: suffix by default, none with builderCode false", async () => {
      const args = {
        agent_id: AGENT_B32, severity: "HIGH", harm_type: "OTHER", description: "x",
        evidence_hash: "ipfs://ev", affected_persons: 1, occurred_at: FIXED_TS - 60, network: "base",
      };
      const hashOf = (text: string) => text.match(/0x[0-9a-fA-F]{64}/)![0];
      const on = await fromSnapshot(async () => txFacts(hashOf(await tool({}, "report_incident", args))));
      const off = await fromSnapshot(async () => txFacts(hashOf(await tool({ builderCode: false }, "report_incident", args))));
      expect(on.data).toBe(off.data + OUR_SUFFIX.slice(2));
      expect(on.logs).toEqual(off.logs);
    });
  });

  it("the same SDK config gets no suffix once the RPC reports another chain id", async () => {
    await fromSnapshot(async () => {
      await provider.send("anvil_setChainId", [31337]);
      try {
        const s = sdk(); // fresh provider: chain id is looked up again
        expect(await s.getAttributionSuffix()).toBe("0x");
        const { txHash } = await s.commitBatch({ agentAddress: AGENT, merkleRoot: "0x" + "22".repeat(32), contentURI: "x", eventCount: 1, complianceScore: 0 });
        expect(decodeSuffix((await txFacts(txHash)).data)).toBeNull();
      } finally {
        await provider.send("anvil_setChainId", [8453]);
      }
    });
  });
});
