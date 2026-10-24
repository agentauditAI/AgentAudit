// Integration: BatchBuffer → AgentAudit.commitBatch → real AuditVault v2 on anvil.
// Acceptance criterion: every inclusion proof the SDK produces verifies on-chain.
// Requires Foundry (`anvil`) and a `forge build` artifact in out/; fails without
// them unless AGENTAUDIT_SKIP_ANVIL=1 is set.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { AgentAudit } from "../../sdk/src/index";
import {
  BatchBuffer,
  MemoryBatchStore,
  canonicalize,
  computeActionRef,
  sha256Hex,
  type ActionPreimage,
} from "../../sdk/src/batch";
import { AuditedOpenAI } from "../../sdk/src/openai";

// ─── Mocks (LLM client only — chain is real) ─────────────────────────────────

const mockCreate = jest.fn();
jest.mock("openai", () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })));

// ─── Environment ─────────────────────────────────────────────────────────────

// anvil default account #0 — public test key, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ARTIFACT = path.join(__dirname, "../../out/AuditVault.sol/AuditVault.json");
const PORT = 18545 + (process.pid % 1000);
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
if (SKIP_ANVIL) console.warn("[batch.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

const VECTOR_PREIMAGES: ActionPreimage[] = [
  { action_type: "send_email", agent_id: "nobulex-test-agent", scope: "user@example.com", timestamp_ms: 1748000000000 },
  { action_type: "delete_database", agent_id: "nobulex-test-agent", scope: "production", timestamp_ms: 1748000001000 },
  { action_type: "transfer_funds", agent_id: "nobulex-test-agent", scope: "100_USDC", timestamp_ms: 1748000002000 },
  { action_type: "transfer_funds", agent_id: "nobulex-test-agent", scope: "500_USDC_to_vendor", timestamp_ms: 1748000003000 },
  {
    action_type: "tool_call",
    agent_id: "agentaudit-example-agent",
    scope: "tool_call:web_search:result_hash:97e2255a47d3fa064bc6f02b70898dbc96ff64bb840b8a2d56b36d9e98b2e681",
    timestamp_ms: 1761264000000,
  },
];

function preimage(i: number): ActionPreimage {
  return { action_type: "LLM_DECISION", agent_id: "7", scope: `llm_call:m:record_hash:${sha256Hex(String(i))}`, timestamp_ms: 1761264000000 + i };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describeAnvil("BatchBuffer × AuditVault v2 on anvil", () => {
  let anvil: ChildProcess;
  let provider: ethers.JsonRpcProvider;
  let vault: ethers.Contract;
  let vaultAddress: string;
  let sdk: AgentAudit;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    if (!hasAnvil()) {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    if (!existsSync(ARTIFACT)) throw new Error(`Missing ${ARTIFACT} — run \`forge build\` first`);
    const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));

    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
    for (let i = 0; ; i++) {
      try {
        await provider.getBlockNumber();
        break;
      } catch {
        if (i > 100) throw new Error("anvil did not start");
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const deployer = new ethers.Wallet(KEY, provider);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
    const deployed = await factory.deploy();
    await deployed.waitForDeployment();
    vaultAddress = await deployed.getAddress();
    vault = new ethers.Contract(vaultAddress, artifact.abi, provider);

    sdk = new AgentAudit({ privateKey: KEY, network: "base", rpcUrl: RPC, auditVaultAddress: vaultAddress });
  });

  afterAll(async () => {
    provider?.destroy();
    anvil?.kill();
  });

  async function expectAllProofsVerifyOnChain(buffer: BatchBuffer, refs: string[], batchIndex: number) {
    const onChain = await vault.getBatch(buffer.agentAddress, batchIndex);
    for (const ref of refs) {
      const p = buffer.getInclusionProof(ref)!;
      expect(p).not.toBeNull();
      expect(p.batchIndex).toBe(batchIndex);
      expect(p.root).toBe(onChain.merkleRoot);
      expect(await sdk.verifyLog(p.agentAddress, batchIndex, p.leaf, p.proof)).toBe(true);
    }
  }

  it("auto-flush at maxEntries: on-chain root equals the SDK root and all 5 proofs verify", async () => {
    const buffer = new BatchBuffer({ committer: sdk, agentAddress: AGENT, maxEntries: 5, complianceScore: 95 });
    const refs: string[] = [];
    for (const p of VECTOR_PREIMAGES) refs.push((await buffer.add(p)).actionRef);

    expect(buffer.size).toBe(0);
    expect(Number(await vault.getBatchCount(AGENT))).toBe(1);
    const onChain = await vault.getBatch(AGENT, 0);
    expect(onChain.eventCount).toBe(5n);
    expect(onChain.complianceScore).toBe(95n);
    expect(onChain.contentURI).toBe(`memory://${onChain.merkleRoot}`);
    expect(onChain.submitter).toBe(sdk.getAddress());

    await expectAllProofsVerifyOnChain(buffer, refs, 0);
  });

  it("rejects a tampered proof and a leaf from another batch on-chain", async () => {
    const buffer = new BatchBuffer({ committer: sdk, agentAddress: AGENT });
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) refs.push((await buffer.add(preimage(100 + i))).actionRef);
    const result = (await buffer.flush())!;
    expect(result.batchIndex).toBe(1);

    const p = buffer.getInclusionProof(refs[0])!;
    expect(await sdk.verifyLog(AGENT, 1, p.leaf, p.proof)).toBe(true);
    expect(await sdk.verifyLog(AGENT, 1, p.leaf, [ethers.ZeroHash, ...p.proof.slice(1)])).toBe(false);
    expect(await sdk.verifyLog(AGENT, 0, p.leaf, p.proof)).toBe(false);
    expect(await sdk.verifyLog(AGENT, 1, computeActionRef(preimage(999)), p.proof)).toBe(false);
  });

  it("single-leaf batch: empty proof verifies", async () => {
    const buffer = new BatchBuffer({ committer: sdk, agentAddress: AGENT });
    const { actionRef } = await buffer.add(preimage(200));
    await buffer.flush();
    const p = buffer.getInclusionProof(actionRef)!;
    expect(p.proof).toEqual([]);
    expect(p.root).toBe(actionRef);
    await expectAllProofsVerifyOnChain(buffer, [actionRef], 2);
  });

  it("odd-node promotion across several levels: all 37 proofs verify on-chain", async () => {
    const buffer = new BatchBuffer({ committer: sdk, agentAddress: AGENT, maxEntries: 37 });
    const refs: string[] = [];
    for (let i = 0; i < 37; i++) refs.push((await buffer.add(preimage(300 + i))).actionRef);
    expect(Number(await vault.getBatchCount(AGENT))).toBe(4);
    await expectAllProofsVerifyOnChain(buffer, refs, 3);
  });

  it("AuditedOpenAI (default batch mode) → flush → proof verifies on-chain; scope commits to the record", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "chatcmpl-abc",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "Yes." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });
    const store = new MemoryBatchStore();
    const client = new AuditedOpenAI({
      agentAudit: { privateKey: KEY, network: "base", rpcUrl: RPC, auditVaultAddress: vaultAddress },
      agentId: 7,
      openaiApiKey: "sk-test",
      batch: { store },
    });

    await client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "Approve?" }] });
    expect(client.buffer!.size).toBe(1);

    const result = (await client.buffer!.flush())!;
    const stored = (await store.get(result.batchId))!;
    const entry = stored.entries[0];

    // Signer address is the default agent address
    expect(stored.agent_address).toBe(sdk.getAddress());
    expect(entry.preimage.action_type).toBe("LLM_DECISION");
    expect(entry.preimage.agent_id).toBe("7");
    expect(entry.preimage.scope).toBe(`llm_call:gpt-4o:record_hash:${sha256Hex(canonicalize(entry.record!))}`);
    expect(JSON.stringify(entry)).not.toContain("Approve?");
    expect(JSON.stringify(entry)).not.toContain("Yes.");

    const p = client.buffer!.getInclusionProof(entry.action_ref)!;
    expect(await sdk.verifyLog(p.agentAddress, result.batchIndex!, p.leaf, p.proof)).toBe(true);
  });
});
