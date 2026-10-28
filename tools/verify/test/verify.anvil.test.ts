// End-to-end: real AuditVault v2 on a fresh anvil, a bundle anchored with
// commitBatch, then the CLI over JSON-RPC (EthersChainReader, real verifyLog).
// Needs Foundry (`anvil`) and out/ from `forge build`; fails without them
// unless AGENTAUDIT_SKIP_ANVIL=1 is set (same rule as the other anvil suites).

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { ethers } from "ethers";
import { main } from "../src/cli";
import { actionRef, LEAF_HASH, merkleProof, merkleRoot, NODE_HASH, ODD_NODE, SCHEMA } from "../src/evidence";

// anvil default account #0 — public test key, never used outside local chains
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ARTIFACT = path.join(__dirname, "../../../out/AuditVault.sol/AuditVault.json");
const PORT = 21545 + (process.pid % 1000);
const RPC = `http://127.0.0.1:${PORT}`;

const describeAnvil = process.env.AGENTAUDIT_SKIP_ANVIL === "1" ? describe.skip : describe;

async function waitForRpc(): Promise<void> {
  for (let i = 0; i <= 100; i++) {
    try {
      await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil did not start");
}

describeAnvil("agentaudit-verify on anvil (AuditVault v2)", () => {
  let anvil: ChildProcess;
  let provider: ethers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  let vaultAddress: string;
  let bundlePath: string;
  let bundle: Record<string, any>;
  let dir: string;

  const run = async (argv: string[]) => {
    const out: string[] = [];
    const code = await main(argv, { out: (l) => out.push(l), err: (l) => out.push(l) });
    return { code, out };
  };

  beforeAll(async () => {
    try {
      execFileSync("anvil", ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
    }
    if (!existsSync(ARTIFACT)) throw new Error(`Missing ${ARTIFACT} — run \`forge build\` first`);
    const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));

    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await waitForRpc();
    provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
    wallet = new ethers.Wallet(KEY, provider);
    const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet).deploy();
    await deployed.waitForDeployment();
    vaultAddress = await deployed.getAddress();
    const vault = new ethers.Contract(vaultAddress, artifact.abi, wallet);

    // 5 entries: exercises the promoted odd node at two levels
    const entries = Array.from({ length: 5 }, (_, i) => {
      const preimage = {
        action_type: "tool_call",
        agent_id: "anvil-agent",
        scope: `tool_call:step_${i}:result_hash:${"0".repeat(63)}${i}`,
        timestamp_ms: 1793188680000 + i * 1000,
      };
      return { action_ref: actionRef(preimage), preimage };
    });
    const root = merkleRoot(entries.map((e) => e.action_ref));

    // A decoy batch first, so the anchored one is batchIndex 1, not 0
    await (await vault.commitBatch(wallet.address, "0x" + "ee".repeat(32), "decoy", 1, 0)).wait();
    const tx = await vault.commitBatch(wallet.address, root, "anvil:test", entries.length, 0);
    await tx.wait();

    bundle = {
      schema: SCHEMA,
      meta: { event_count: entries.length, anchor: { chain: "anvil", txHash: tx.hash, rootCommitment: root.slice(2) } },
      leaf_hash: LEAF_HASH,
      node_hash: NODE_HASH,
      odd_node: ODD_NODE,
      merkle_root: root,
      entries,
    };
    dir = mkdtempSync(path.join(tmpdir(), "aa-verify-anvil-"));
    bundlePath = path.join(dir, "bundle.json");
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  }, 60_000);

  afterAll(() => {
    provider?.destroy();
    anvil?.kill();
  });

  it("passes every check over JSON-RPC, then fails tampered preimage, wrong txHash and swapped proofs", async () => {
    const ok = await run([bundlePath, "--rpc", RPC, "--vault", vaultAddress, "--submitter", wallet.address]);
    expect(ok.out.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(`INFO  batch agentId ${wallet.address}, batchIndex 1, contentURI anvil:test`);
    expect(ok.out.filter((l) => /^PASS {2}entry\[\d\]\.verifyLog +true \(derived proof/.test(l))).toHaveLength(5);
    expect(ok.out[ok.out.length - 1]).toBe("RESULT  PASS  19/19 checks passed");

    // Tampered preimage
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.entries[3].preimage.agent_id = "someone-else";
    writeFileSync(path.join(dir, "tampered.json"), JSON.stringify(tampered));
    const t = await run([path.join(dir, "tampered.json"), "--rpc", RPC, "--vault", vaultAddress]);
    expect(t.code).toBe(1);
    expect(t.out.filter((l) => l.startsWith("FAIL")).map((l) => l.split(/\s+/)[1])).toEqual([
      "entry[3].action_ref",
      "merkle_root",
      "entry[3].verifyLog",
    ]);

    // Wrong txHash: the decoy batch's transaction (nonce 1)
    const decoyTx = (await provider.getBlock(2))!.transactions[0];
    const wrongTx = JSON.parse(JSON.stringify(bundle));
    wrongTx.meta.anchor.txHash = decoyTx;
    writeFileSync(path.join(dir, "wrong-tx.json"), JSON.stringify(wrongTx));
    const w = await run([path.join(dir, "wrong-tx.json"), "--rpc", RPC, "--vault", vaultAddress]);
    expect(w.code).toBe(1);
    expect(w.out.some((l) => /^FAIL {2}anchor\.event +on-chain root 0xeeee/.test(l))).toBe(true);

    // Swapped proofs, checked by the real contract
    const leaves = bundle.entries.map((e: { action_ref: string }) => e.action_ref);
    const swapped = JSON.parse(JSON.stringify(bundle));
    swapped.entries.forEach((e: { proof?: string[] }, i: number) => (e.proof = merkleProof(leaves, i)));
    [swapped.entries[1].proof, swapped.entries[4].proof] = [swapped.entries[4].proof, swapped.entries[1].proof];
    writeFileSync(path.join(dir, "swapped.json"), JSON.stringify(swapped));
    const s = await run([path.join(dir, "swapped.json"), "--rpc", RPC, "--vault", vaultAddress]);
    expect(s.code).toBe(1);
    expect(s.out.filter((l) => l.startsWith("FAIL")).map((l) => l.split(/\s+/)[1])).toEqual([
      "entry[1].verifyLog",
      "entry[4].verifyLog",
    ]);
  }, 60_000);
});
