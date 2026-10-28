// AgentAudit AI — verifies an Evidence Schema v1 bundle end to end: preimages →
// action_refs → Merkle root → AuditVault v2 LogBatchCommitted → verifyLog.
// Applies the verifier mitigations in docs/THREAT_MODEL.md (KI-1, KI-2).
// EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)

import { ethers } from "ethers";
import {
  LEAF_HASH,
  NODE_HASH,
  ODD_NODE,
  SCHEMA,
  actionRef,
  merkleProof,
  merkleRoot,
  preimageProblem,
} from "./evidence";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = "PASS" | "FAIL";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: Check[];
  /** Context that is reported but not pass/fail (e.g. submitter when not pinned) */
  info: string[];
}

export interface LogLike {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface ReceiptLike {
  status: number | null;
  blockNumber: number;
  logs: readonly LogLike[];
}

/** The chain reads the verifier needs; EthersChainReader is the real one */
export interface ChainReader {
  chainId(): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getReceipt(txHash: string): Promise<ReceiptLike | null>;
  getBatchSubmitter(vault: string, agentId: string, batchIndex: bigint): Promise<string>;
  verifyLog(vault: string, agentId: string, batchIndex: bigint, leaf: string, proof: string[]): Promise<boolean>;
}

export interface VerifyOptions {
  reader: ChainReader;
  /** AuditVault v2 address; defaults to the known deployment for meta.anchor.chain */
  vault?: string;
  /** If set, LogBatch.submitter must equal it (THREAT_MODEL KI-1) */
  submitter?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const AUDIT_VAULT_V2_ABI = [
  "event LogBatchCommitted(address indexed agentId, uint256 indexed batchIndex, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore, uint256 timestamp)",
  "function verifyLog(address agentId, uint256 batchIndex, bytes32 logHash, bytes32[] proof) view returns (bool)",
  "function getBatch(address agentId, uint256 batchIndex) view returns (tuple(bytes32 merkleRoot, string contentURI, uint256 timestamp, uint256 blockNumber, uint256 eventCount, address submitter, uint8 complianceScore))",
];

/** Chains with a known chain id and, where deployed, AuditVault v2 */
export const KNOWN_CHAINS: Record<string, { chainId: bigint; vault?: string }> = {
  base: { chainId: 8453n, vault: "0xCeE831070aa9081422f30df5559c125aa47A75DB" },
  anvil: { chainId: 31337n },
};

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const iface = new ethers.Interface(AUDIT_VAULT_V2_ABI);
const BATCH_TOPIC = iface.getEvent("LogBatchCommitted")!.topicHash;

// ─── Chain reader ─────────────────────────────────────────────────────────────

export class EthersChainReader implements ChainReader {
  private readonly provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string, timeoutMs = 30_000) {
    const req = new ethers.FetchRequest(rpcUrl);
    req.timeout = timeoutMs;
    // staticNetwork: an unreachable RPC fails the call instead of retrying network detection forever
    this.provider = new ethers.JsonRpcProvider(req, undefined, { staticNetwork: true });
  }

  async chainId(): Promise<bigint> {
    return BigInt(await this.provider.send("eth_chainId", []));
  }

  getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  async getReceipt(txHash: string): Promise<ReceiptLike | null> {
    return this.provider.getTransactionReceipt(txHash);
  }

  async getBatchSubmitter(vault: string, agentId: string, batchIndex: bigint): Promise<string> {
    const batch = await new ethers.Contract(vault, AUDIT_VAULT_V2_ABI, this.provider).getBatch(agentId, batchIndex);
    return batch.submitter as string;
  }

  async verifyLog(vault: string, agentId: string, batchIndex: bigint, leaf: string, proof: string[]): Promise<boolean> {
    return (await new ethers.Contract(vault, AUDIT_VAULT_V2_ABI, this.provider).verifyLog(
      agentId,
      batchIndex,
      leaf,
      proof,
    )) as boolean;
  }

  destroy(): void {
    this.provider.destroy();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) return String((err as { shortMessage: unknown }).shortMessage);
  return err instanceof Error ? err.message : String(err);
}

function short(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Bare or 0x 64-hex → 0x lowercase, else null */
function normRoot(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const hex = v.startsWith("0x") ? v : "0x" + v;
  return BYTES32_RE.test(hex) ? hex.toLowerCase() : null;
}

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Runs every check it can and never throws: a failed prerequisite turns its
 * dependent checks into FAILs with the reason, so the report is always complete.
 */
export async function verifyBundle(bundleInput: unknown, opts: VerifyOptions): Promise<VerifyResult> {
  const checks: Check[] = [];
  const info: string[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, status: "PASS", detail });
  const fail = (name: string, detail: string) => checks.push({ name, status: "FAIL", detail });
  const done = (): VerifyResult => ({ ok: checks.length > 0 && checks.every((c) => c.status === "PASS"), checks, info });

  // ── 1. Bundle shape ──
  const bundle = asObject(bundleInput);
  if (!bundle) {
    fail("bundle.schema", "bundle is not a JSON object");
    return done();
  }
  const entries = Array.isArray(bundle.entries) ? (bundle.entries as unknown[]) : null;
  const shapeProblems: string[] = [];
  if (bundle.schema !== SCHEMA) shapeProblems.push(`schema is ${JSON.stringify(bundle.schema)}, expected "${SCHEMA}"`);
  if (bundle.leaf_hash !== LEAF_HASH) shapeProblems.push(`leaf_hash is ${JSON.stringify(bundle.leaf_hash)}, expected "${LEAF_HASH}"`);
  if (bundle.node_hash !== NODE_HASH) shapeProblems.push(`node_hash is ${JSON.stringify(bundle.node_hash)}, expected "${NODE_HASH}"`);
  if (bundle.odd_node !== ODD_NODE) shapeProblems.push(`odd_node is ${JSON.stringify(bundle.odd_node)}, expected "${ODD_NODE}"`);
  if (!entries || entries.length === 0) shapeProblems.push("entries is missing or empty");
  const claimedRoot = normRoot(bundle.merkle_root);
  if (!claimedRoot) shapeProblems.push("merkle_root is not a 32-byte hex string");
  if (shapeProblems.length > 0) {
    // Without the v1 tree rules nothing below is meaningful
    fail("bundle.schema", shapeProblems.join("; "));
    return done();
  }
  pass("bundle.schema", `${SCHEMA}, ${entries!.length} entries`);

  // ── 2. action_ref per entry (recomputed — never trust the presented leaf, KI-2) ──
  const leaves: (string | null)[] = [];
  entries!.forEach((raw, i) => {
    const name = `entry[${i}].action_ref`;
    const entry = asObject(raw);
    if (!entry) {
      fail(name, "entry is not an object");
      leaves.push(null);
      return;
    }
    const problem = preimageProblem(entry.preimage);
    if (problem) {
      fail(name, problem);
      leaves.push(null);
      return;
    }
    let computed: string;
    try {
      computed = actionRef(entry.preimage);
    } catch (err) {
      fail(name, errorMessage(err));
      leaves.push(null);
      return;
    }
    leaves.push(computed);
    const presented = typeof entry.action_ref === "string" ? entry.action_ref.toLowerCase() : entry.action_ref;
    if (presented === computed) pass(name, computed);
    else fail(name, `sha256(jcs(preimage)) = ${computed}, bundle says ${String(entry.action_ref)}`);
  });

  // ── 3. Merkle root ──
  const allLeaves = leaves.every((l): l is string => l !== null);
  if (!allLeaves) {
    fail("merkle_root", "cannot rebuild the tree: some preimages are invalid");
  } else {
    const rebuilt = merkleRoot(leaves);
    if (rebuilt === claimedRoot) pass("merkle_root", `rebuilt ${rebuilt}`);
    else fail("merkle_root", `rebuilt ${rebuilt}, bundle says ${claimedRoot}`);
  }

  // ── 4. Anchor reference ──
  const anchor = asObject(asObject(bundle.meta)?.anchor);
  const txHash = typeof anchor?.txHash === "string" ? anchor.txHash : null;
  const chain = typeof anchor?.chain === "string" ? anchor.chain : null;
  if (!anchor || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    fail("anchor.reference", "meta.anchor.txHash is missing or not a 32-byte 0x hex string");
    return done();
  }
  const rootCommitment = normRoot(anchor.rootCommitment);
  if (anchor.rootCommitment !== undefined && rootCommitment !== claimedRoot) {
    fail("anchor.reference", `meta.anchor.rootCommitment ${String(anchor.rootCommitment)} ≠ merkle_root ${claimedRoot}`);
  } else {
    pass("anchor.reference", `chain ${chain ?? "(unset)"}, tx ${txHash}`);
  }

  const known = chain ? KNOWN_CHAINS[chain] : undefined;
  const vault = opts.vault ?? known?.vault;
  if (!vault || !ethers.isAddress(vault)) {
    fail(
      "anchor.vault",
      vault ? `--vault ${vault} is not an address` : `no known AuditVault v2 for chain ${JSON.stringify(chain)}; pass --vault`,
    );
    return done();
  }
  const vaultAddr = ethers.getAddress(vault);
  const { reader } = opts;

  // ── 5. RPC chain + vault code ──
  try {
    const id = await reader.chainId();
    if (known && id !== known.chainId) fail("rpc.chain", `RPC is chain ${id}, meta.anchor.chain "${chain}" is ${known.chainId}`);
    else pass("rpc.chain", known ? `chain id ${id} = ${chain}` : `chain id ${id} (chain "${chain}" not in the known list, not cross-checked)`);
    const code = await reader.getCode(vaultAddr);
    if (code === "0x") {
      fail("anchor.vault", `no contract code at ${vaultAddr}`);
      return done();
    }
    pass("anchor.vault", `${vaultAddr}${opts.vault ? "" : ` (default for ${chain})`}`);
  } catch (err) {
    fail("rpc.chain", `RPC error: ${errorMessage(err)}`);
    return done();
  }

  // ── 6. Receipt + LogBatchCommitted ──
  let receipt: ReceiptLike | null;
  try {
    receipt = await reader.getReceipt(txHash);
  } catch (err) {
    fail("anchor.receipt", `RPC error: ${errorMessage(err)}`);
    return done();
  }
  if (!receipt) {
    fail("anchor.receipt", `transaction ${txHash} not found (no receipt)`);
    return done();
  }
  if (receipt.status !== 1) {
    fail("anchor.receipt", `transaction reverted (status ${receipt.status}) in block ${receipt.blockNumber}`);
    return done();
  }
  pass("anchor.receipt", `status 1, block ${receipt.blockNumber}`);

  const batchLogs = receipt.logs
    .filter((l) => ethers.getAddress(l.address) === vaultAddr && l.topics[0] === BATCH_TOPIC)
    .map((l) => iface.parseLog({ topics: [...l.topics], data: l.data })!);
  if (batchLogs.length === 0) {
    fail("anchor.event", `transaction emitted no LogBatchCommitted from ${vaultAddr}`);
    return done();
  }
  // A tx could commit several batches; prefer the one carrying our root
  const ev = batchLogs.find((l) => (l.args.merkleRoot as string).toLowerCase() === claimedRoot) ?? batchLogs[0];
  const onChainRoot = (ev.args.merkleRoot as string).toLowerCase();
  const agentId = ethers.getAddress(ev.args.agentId as string);
  const batchIndex = ev.args.batchIndex as bigint;
  const eventCount = ev.args.eventCount as bigint;
  info.push(`batch agentId ${agentId}, batchIndex ${batchIndex}, contentURI ${String(ev.args.contentURI)}`);
  if (onChainRoot === claimedRoot) pass("anchor.event", `LogBatchCommitted root ${onChainRoot}`);
  else fail("anchor.event", `on-chain root ${onChainRoot} ≠ merkle_root ${claimedRoot}`);
  if (eventCount === BigInt(entries!.length)) pass("anchor.event_count", `${eventCount}`);
  else fail("anchor.event_count", `on-chain eventCount ${eventCount}, bundle has ${entries!.length} entries`);

  // ── 7. Submitter (KI-1) ──
  try {
    const submitter = ethers.getAddress(await reader.getBatchSubmitter(vaultAddr, agentId, batchIndex));
    if (!opts.submitter) {
      info.push(`submitter ${submitter} — not checked (commitBatch is permissionless; pin it with --submitter)`);
    } else if (ethers.isAddress(opts.submitter) && ethers.getAddress(opts.submitter) === submitter) {
      pass("anchor.submitter", submitter);
    } else {
      fail("anchor.submitter", `LogBatch.submitter is ${submitter}, expected ${opts.submitter}`);
    }
  } catch (err) {
    if (opts.submitter) fail("anchor.submitter", `getBatch failed: ${errorMessage(err)}`);
    else info.push(`submitter unavailable: ${errorMessage(err)}`);
  }

  // ── 8. verifyLog per entry ──
  // The leaf is always the recomputed action_ref. Proof siblings are only path
  // data, so besides the recomputed tree we may also try the tree of the
  // presented action_refs: after one tampered preimage, every recomputed path
  // runs through the tampered subtree, and only the presented values let the
  // intact entries still prove inclusion — which localizes the bad one.
  const presented = entries!.map((raw) => {
    const ref = asObject(raw)?.action_ref;
    return typeof ref === "string" && BYTES32_RE.test(ref) ? ref.toLowerCase() : null;
  });
  const siblingTrees: [string, string[]][] = [];
  if (allLeaves) siblingTrees.push(["derived proof", leaves]);
  if (presented.every((p): p is string => p !== null) && !(allLeaves && presented.every((p, i) => p === leaves[i]))) {
    siblingTrees.push(["proof from bundle action_refs", presented]);
  }

  for (let i = 0; i < entries!.length; i++) {
    const name = `entry[${i}].verifyLog`;
    const leaf = leaves[i];
    if (!leaf) {
      fail(name, "skipped: action_ref could not be recomputed");
      continue;
    }
    const entry = asObject(entries![i])!;
    let candidates: [string, string[]][];
    if (entry.proof !== undefined) {
      if (!Array.isArray(entry.proof) || !entry.proof.every((p) => typeof p === "string" && BYTES32_RE.test(p))) {
        fail(name, "entry.proof is not an array of bytes32 hex strings");
        continue;
      }
      candidates = [["bundle proof", entry.proof as string[]]];
    } else if (siblingTrees.length > 0) {
      candidates = siblingTrees.map(([source, tree]) => [source, merkleProof(tree, i)]);
    } else {
      fail(name, "skipped: no entry.proof and no tree to derive one from");
      continue;
    }
    try {
      let passed: [string, string[]] | undefined;
      for (const [source, proof] of candidates) {
        if (await reader.verifyLog(vaultAddr, agentId, batchIndex, leaf, proof)) {
          passed = [source, proof];
          break;
        }
      }
      if (passed) pass(name, `true (${passed[0]}, ${passed[1].length} node${passed[1].length === 1 ? "" : "s"}, leaf ${short(leaf)})`);
      else fail(name, `AuditVault.verifyLog returned false (${candidates.map((c) => c[0]).join(", ")}; leaf ${short(leaf)})`);
    } catch (err) {
      fail(name, `call failed: ${errorMessage(err)}`);
    }
  }

  return done();
}
