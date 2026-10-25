"use strict";

// Integration: ElizaOS plugin action → BatchBuffer → commitBatch on a real
// AuditVault v2 (anvil) → verifyLog. Requires Foundry (`anvil`) and a
// `forge build` artifact in out/; fails without them unless
// AGENTAUDIT_SKIP_ANVIL=1 is set.

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

// anvil default account #0 — public test key, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ARTIFACT = path.join(__dirname, "../../out/AuditVault.sol/AuditVault.json");
const PORT = 19545 + (process.pid % 1000);
const RPC = `http://127.0.0.1:${PORT}`;

function hasAnvil() {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SKIP_ANVIL = process.env.AGENTAUDIT_SKIP_ANVIL === "1";
const describeAnvil = SKIP_ANVIL ? describe.skip : describe;
if (SKIP_ANVIL) console.warn("[plugin.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

describeAnvil("ElizaOS plugin × AuditVault v2 on anvil", () => {
  let anvil;
  let provider;
  let vault;
  let plugin;
  let batchDir;
  const savedEnv = {};
  const ENV = ["AUDIT_PRIVATE_KEY", "AUDIT_NETWORK", "AUDIT_RPC_URL", "AUDIT_VAULT_ADDRESS", "AUDIT_AGENT_ID", "AUDIT_BATCH_DIR", "AUDIT_AUTO_LOG"];

  jest.setTimeout(60_000);

  const runtime = { agentId: "anvil-agent" };
  const action = (name) => plugin.actions.find((a) => a.name === name);
  const signer = new ethers.Wallet(KEY).address;

  async function verifyOnChain(actionRef) {
    const p = plugin.batch.getInclusionProof(actionRef);
    expect(p).not.toBeNull();
    expect(p.agentAddress).toBe(signer);
    const onChain = await vault.getBatch(p.agentAddress, p.batchIndex);
    expect(onChain.merkleRoot).toBe(p.root);
    expect(onChain.submitter).toBe(signer);
    return vault.verifyLog(p.agentAddress, p.batchIndex, p.leaf, p.proof);
  }

  beforeAll(async () => {
    if (!hasAnvil()) {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    if (!fs.existsSync(ARTIFACT)) throw new Error(`Missing ${ARTIFACT} — run \`forge build\` first`);
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));

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
    const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer).deploy();
    await deployed.waitForDeployment();
    const vaultAddress = await deployed.getAddress();
    vault = new ethers.Contract(vaultAddress, artifact.abi, provider);

    batchDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentaudit-plugin-anvil-"));
    for (const k of ENV) savedEnv[k] = process.env[k];
    Object.assign(process.env, {
      AUDIT_PRIVATE_KEY: KEY,
      AUDIT_NETWORK: "base",
      AUDIT_RPC_URL: RPC,
      AUDIT_VAULT_ADDRESS: vaultAddress,
      AUDIT_AGENT_ID: "7",
      AUDIT_BATCH_DIR: batchDir,
    });
    delete process.env.AUDIT_AUTO_LOG;

    plugin = require("../../plugin-elizaos/index.js");
    plugin.batch._reset();
  });

  afterAll(async () => {
    if (plugin) await plugin.batch.close().catch(() => {});
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (batchDir) fs.rmSync(batchDir, { recursive: true, force: true });
    provider?.destroy();
    anvil?.kill();
  });

  it("LOG_AUDIT (buffered) ×3 → close → every action_ref verifies on-chain", async () => {
    const refs = [];
    for (const text of ["approve loan #1", "deny loan #2", "escalate loan #3"]) {
      const cb = jest.fn();
      expect(await action("LOG_AUDIT").handler(runtime, { content: { text } }, {}, { actionType: "LOAN_DECISION", riskLevel: "HIGH" }, cb)).toBe(true);
      expect(cb.mock.calls[0][0].txHash).toBeUndefined();
      refs.push(cb.mock.calls[0][0].actionRef);
    }
    expect(plugin.batch.pending()).toBe(3);

    const result = await plugin.batch.close();
    expect(result.eventCount).toBe(3);
    expect(Number(await vault.getBatchCount(signer))).toBe(1);

    for (const ref of refs) expect(await verifyOnChain(ref)).toBe(true);

    // Batch file holds hashes only
    const file = fs.readFileSync(path.join(batchDir, `${result.batchId}.json`), "utf8");
    expect(file).not.toMatch(/loan #/);
  });

  it("LOG_AUDIT_BATCH anchors in one tx; proofs verify, tampered proof does not", async () => {
    const cb = jest.fn();
    const actions = [
      { type: "TRANSFER", payload: "send 10 USDC", riskLevel: "LOW" },
      { type: "APPROVE", payload: "approve token", riskLevel: "HIGH" },
      { type: "SWAP", payload: "swap 5 ETH", riskLevel: "MEDIUM" },
    ];
    expect(await action("LOG_AUDIT_BATCH").handler(runtime, { content: {} }, {}, { actions }, cb)).toBe(true);
    const { txHash, actionRefs, count } = cb.mock.calls[0][0];
    expect(count).toBe(3);
    expect((await provider.getTransactionReceipt(txHash)).status).toBe(1);

    for (const ref of actionRefs) expect(await verifyOnChain(ref)).toBe(true);

    const p = plugin.batch.getInclusionProof(actionRefs[0]);
    expect(await vault.verifyLog(p.agentAddress, p.batchIndex, p.leaf, [ethers.ZeroHash, ...p.proof.slice(1)])).toBe(false);
    expect(await vault.verifyLog(p.agentAddress, p.batchIndex - 1, p.leaf, p.proof)).toBe(false);
  });

  it("LOG_AUDIT with flush: true anchors a single-leaf batch immediately", async () => {
    const cb = jest.fn();
    await action("LOG_AUDIT").handler(runtime, { content: { text: "urgent" } }, {}, { flush: true }, cb);
    const { actionRef, txHash } = cb.mock.calls[0][0];
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plugin.batch.getInclusionProof(actionRef).proof).toEqual([]);
    expect(await verifyOnChain(actionRef)).toBe(true);
  });

  it("auto-log middleware entries anchor and verify", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    const next = jest.fn().mockResolvedValue(undefined);
    await plugin.middleware(runtime, { content: { text: "hello" } }, {}, next);
    await plugin.middleware(runtime, { content: { text: "world" } }, {}, next);
    delete process.env.AUDIT_AUTO_LOG;
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledTimes(2);

    const result = await plugin.batch.flush();
    expect(result.eventCount).toBe(2);
    const batch = JSON.parse(fs.readFileSync(path.join(batchDir, `${result.batchId}.json`), "utf8"));
    for (const e of batch.entries) {
      expect(e.preimage.action_type).toBe("AUTO_LOG");
      expect(await verifyOnChain(e.action_ref)).toBe(true);
    }
  });

  it("AUDIT_STATUS reports the on-chain batch count from the vault", async () => {
    const cb = jest.fn();
    expect(await action("AUDIT_STATUS").handler(runtime, { content: {} }, {}, {}, cb)).toBe(true);
    const { count, pending, text } = cb.mock.calls[0][0];
    expect(count).toBe(String(await vault.getBatchCount(signer)));
    expect(count).toBe("4");
    expect(pending).toBe(0);
    expect(text).toMatch(/Batch anchoring: available/);
  });
});
