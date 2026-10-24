// AgentAudit AI — Batch anchoring
// Buffers action_refs (docs/EVIDENCE_SCHEMA.md) and anchors them on-chain as a
// single Merkle root via AuditVault v2 commitBatch.
// EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)

import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { ethers } from "ethers";

// ─── JCS (RFC 8785) ───────────────────────────────────────────────────────────

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * Strings and numbers use ECMAScript JSON.stringify serialization (as RFC 8785
 * specifies); object keys are sorted by UTF-16 code units (Array#sort default).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`JCS: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `value`, no prefix */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ─── Evidence Schema v1 ───────────────────────────────────────────────────────

export const EVIDENCE_SCHEMA = "agentaudit-evidence-v1";

export interface ActionPreimage {
  action_type: string;
  agent_id: string;
  scope: string;
  timestamp_ms: number;
}

/** Copy only the four preimage fields — envelope fields must never leak in */
function pickPreimage(p: ActionPreimage): ActionPreimage {
  return {
    action_type: p.action_type,
    agent_id: p.agent_id,
    scope: p.scope,
    timestamp_ms: p.timestamp_ms,
  };
}

/** action_ref = SHA-256(JCS(preimage)), as 0x-prefixed bytes32 hex */
export function computeActionRef(preimage: ActionPreimage): string {
  if (!Number.isSafeInteger(preimage.timestamp_ms)) {
    throw new Error("timestamp_ms must be an integer (Unix ms)");
  }
  return "0x" + sha256Hex(canonicalize(pickPreimage(preimage)));
}

/** Percent-encode the characters that would break a scope segment */
export function encodeScopeSegment(segment: string): string {
  return segment.replace(/%/g, "%25").replace(/:/g, "%3A");
}

/** §2.1 — tool_call:<tool>:result_hash:<sha256> */
export function toolCallScope(tool: string, resultHash: string): string {
  return `tool_call:${encodeScopeSegment(tool)}:result_hash:${resultHash}`;
}

/** §2.2 — data_read:<endpoint>:<dataset_version>:<result_hash> */
export function dataReadScope(endpoint: string, datasetVersion: string, resultHash: string): string {
  return `data_read:${encodeScopeSegment(endpoint)}:${encodeScopeSegment(datasetVersion)}:${resultHash}`;
}

/** §2.3 — llm_call:<model>:record_hash:<sha256(JCS(record))> */
export function llmCallScope(model: string, record: object): string {
  return `llm_call:${encodeScopeSegment(model)}:record_hash:${sha256Hex(canonicalize(record))}`;
}

/** Preimage for an LLM decision logged by the SDK wrappers */
export function llmDecisionPreimage(
  agentId: number | string,
  model: string,
  record: object,
  timestampMs: number = Date.now()
): ActionPreimage {
  return {
    action_type: "LLM_DECISION",
    agent_id: String(agentId),
    scope: llmCallScope(model, record),
    timestamp_ms: timestampMs,
  };
}

// ─── Merkle tree (matches AuditVault v2 _verifyMerkle) ───────────────────────
//
// Leaves:  action_ref values as-is (the contract does not re-hash leaves).
// Nodes:   keccak256(abi.encodePacked(min(a, b), max(a, b))) — sorted pairs.
// Odd:     an unpaired last node is promoted unchanged to the next level.

const BYTES32 = /^0x[0-9a-f]{64}$/;

function assertBytes32(value: string, label: string): string {
  const v = value.toLowerCase();
  if (!BYTES32.test(v)) throw new Error(`${label} is not a bytes32 hex string: ${value}`);
  return v;
}

export function hashPair(a: string, b: string): string {
  const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/** All tree levels, leaves first, root level last */
export function buildMerkleLevels(leaves: string[]): string[][] {
  if (leaves.length === 0) throw new Error("Merkle tree needs at least one leaf");
  const levels = [leaves.map((l) => assertBytes32(l, "leaf"))];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: string[]): string {
  const levels = buildMerkleLevels(leaves);
  return levels[levels.length - 1][0];
}

/** Sibling path for leaf `index`; levels where the node was promoted are skipped */
export function merkleProof(levels: string[][], index: number): string[] {
  if (index < 0 || index >= levels[0].length) throw new Error(`leaf index ${index} out of range`);
  const proof: string[] = [];
  let idx = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const sibling = idx ^ 1;
    if (sibling < levels[l].length) proof.push(levels[l][sibling]);
    idx >>= 1;
  }
  return proof;
}

/** Off-chain mirror of AuditVault._verifyMerkle */
export function verifyMerkleProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf.toLowerCase();
  for (const sibling of proof) computed = hashPair(computed, sibling.toLowerCase());
  return computed === root.toLowerCase();
}

// ─── Batch store (pluggable; IPFS later) ─────────────────────────────────────

export interface BatchEntry {
  action_ref: string;
  preimage: ActionPreimage;
  /** Hashed audit record the scope commits to — never raw prompt/response content */
  record?: object;
}

export interface BatchRecord {
  schema: typeof EVIDENCE_SCHEMA;
  batch_id: string;
  agent_address: string;
  merkle_root: string;
  leaf_hash: "sha256(jcs(preimage))";
  node_hash: "keccak256(sorted_pair)";
  odd_node: "promote";
  created_at_ms: number;
  entries: BatchEntry[];
}

export interface BatchStore {
  /** Persist the batch and return the contentURI to anchor on-chain */
  put(record: BatchRecord): Promise<string>;
  get(batchId: string): Promise<BatchRecord | null>;
}

export class MemoryBatchStore implements BatchStore {
  private readonly records = new Map<string, BatchRecord>();

  async put(record: BatchRecord): Promise<string> {
    this.records.set(record.batch_id, record);
    return `memory://${record.batch_id}`;
  }

  async get(batchId: string): Promise<BatchRecord | null> {
    return this.records.get(batchId) ?? null;
  }
}

/** Writes one JSON file per batch: <dir>/<batch_id>.json */
export class FileBatchStore implements BatchStore {
  constructor(private readonly dir: string) {}

  private file(batchId: string): string {
    return path.resolve(this.dir, `${batchId}.json`);
  }

  async put(record: BatchRecord): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.file(record.batch_id);
    await fs.writeFile(file, JSON.stringify(record, null, 2) + "\n", "utf8");
    return `file://${file}`;
  }

  async get(batchId: string): Promise<BatchRecord | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(batchId), "utf8")) as BatchRecord;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
}

// ─── Batch buffer ─────────────────────────────────────────────────────────────

export interface CommitBatchParams {
  agentAddress: string;
  merkleRoot: string;
  contentURI: string;
  eventCount: number;
  complianceScore: number;
}

export interface CommitBatchResult {
  txHash: string;
  /** Per-agent batch index from LogBatchCommitted; null if not found in receipt */
  batchIndex: number | null;
}

/** Anything that can call AuditVault v2 commitBatch — AgentAudit implements it */
export interface BatchCommitter {
  commitBatch(params: CommitBatchParams): Promise<CommitBatchResult>;
}

export interface BatchBufferConfig {
  committer: BatchCommitter;
  /** Agent address the batch is committed under (AuditVault v2 keys agents by address) */
  agentAddress: string;
  store?: BatchStore;
  /** Flush when this many entries are buffered (default 50) */
  maxEntries?: number;
  /** Flush this many seconds after the first buffered entry (default 60) */
  maxAgeSeconds?: number;
  /** uint8 0–100 passed to commitBatch (default 0 = not assessed by SDK) */
  complianceScore?: number;
  /** Receives errors from timer-triggered flushes (default console.error) */
  onError?: (err: Error) => void;
}

export interface FlushResult {
  batchId: string;
  merkleRoot: string;
  contentURI: string;
  eventCount: number;
  txHash: string;
  batchIndex: number | null;
}

export interface InclusionProof {
  leaf: string;
  proof: string[];
  root: string;
  batchId: string;
  /** Pass to AuditVault.verifyLog(agentAddress, batchIndex, leaf, proof) */
  batchIndex: number | null;
  agentAddress: string;
  txHash: string;
}

interface CommittedBatch {
  levels: string[][];
  batchIndex: number | null;
  txHash: string;
}

/**
 * Collects action_refs and anchors them as one Merkle root per batch.
 * Flushes on maxEntries, on maxAgeSeconds after the first entry, or on flush().
 * Flushes are serialized; a failed flush re-queues its entries for retry.
 */
export class BatchBuffer {
  readonly agentAddress: string;
  private readonly committer: BatchCommitter;
  private readonly store: BatchStore;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly complianceScore: number;
  private readonly onError: (err: Error) => void;

  private pending: BatchEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private flushChain: Promise<unknown> = Promise.resolve();
  private readonly index = new Map<string, { batchId: string; leafIndex: number }>();
  private readonly batches = new Map<string, CommittedBatch>();

  constructor(config: BatchBufferConfig) {
    this.committer = config.committer;
    this.agentAddress = ethers.getAddress(config.agentAddress);
    this.store = config.store ?? new MemoryBatchStore();
    this.maxEntries = config.maxEntries ?? 50;
    this.maxAgeMs = (config.maxAgeSeconds ?? 60) * 1000;
    this.complianceScore = config.complianceScore ?? 0;
    this.onError = config.onError ?? ((err) => console.error("[BatchBuffer] flush failed:", err.message));

    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    if (!(this.maxAgeMs > 0)) throw new Error("maxAgeSeconds must be positive");
    if (!Number.isInteger(this.complianceScore) || this.complianceScore < 0 || this.complianceScore > 100) {
      throw new Error("complianceScore must be an integer 0–100");
    }
  }

  /** Number of entries waiting for the next flush */
  get size(): number {
    return this.pending.length;
  }

  /**
   * Buffer one action. Resolves once buffered — or, if this entry fills the
   * batch, once that flush completes (so commit errors reach the caller).
   */
  async add(preimage: ActionPreimage, record?: object): Promise<{ actionRef: string }> {
    const actionRef = computeActionRef(preimage);
    this.pending.push({ action_ref: actionRef, preimage: pickPreimage(preimage), record });

    if (this.pending.length >= this.maxEntries) {
      await this.flush();
    } else {
      this._armTimer();
    }
    return { actionRef };
  }

  /** Anchor everything buffered now. Resolves null if there was nothing to flush. */
  flush(): Promise<FlushResult | null> {
    const run = this.flushChain.then(() => this._flush());
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  /** Stop the timer and flush whatever is left */
  async close(): Promise<FlushResult | null> {
    this._clearTimer();
    return this.flush();
  }

  /** Proof for a committed action_ref; null if unknown or still pending */
  getInclusionProof(actionRef: string): InclusionProof | null {
    const loc = this.index.get(actionRef.toLowerCase());
    if (!loc) return null;
    const batch = this.batches.get(loc.batchId)!;
    return {
      leaf: batch.levels[0][loc.leafIndex],
      proof: merkleProof(batch.levels, loc.leafIndex),
      root: loc.batchId,
      batchId: loc.batchId,
      batchIndex: batch.batchIndex,
      agentAddress: this.agentAddress,
      txHash: batch.txHash,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async _flush(): Promise<FlushResult | null> {
    this._clearTimer();
    if (this.pending.length === 0) return null;

    const entries = this.pending;
    this.pending = [];

    try {
      const levels = buildMerkleLevels(entries.map((e) => e.action_ref));
      const root = levels[levels.length - 1][0];

      const record: BatchRecord = {
        schema: EVIDENCE_SCHEMA,
        batch_id: root,
        agent_address: this.agentAddress,
        merkle_root: root,
        leaf_hash: "sha256(jcs(preimage))",
        node_hash: "keccak256(sorted_pair)",
        odd_node: "promote",
        created_at_ms: Date.now(),
        entries,
      };
      const contentURI = await this.store.put(record);

      const { txHash, batchIndex } = await this.committer.commitBatch({
        agentAddress: this.agentAddress,
        merkleRoot: root,
        contentURI,
        eventCount: entries.length,
        complianceScore: this.complianceScore,
      });

      this.batches.set(root, { levels, batchIndex, txHash });
      entries.forEach((e, i) => this.index.set(e.action_ref, { batchId: root, leafIndex: i }));

      return { batchId: root, merkleRoot: root, contentURI, eventCount: entries.length, txHash, batchIndex };
    } catch (err) {
      // Keep the evidence: put the entries back in front of anything added meanwhile
      this.pending = entries.concat(this.pending);
      this._armTimer();
      throw err;
    }
  }

  private _armTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch((err: Error) => this.onError(err));
    }, this.maxAgeMs);
    // Never keep the process alive just to flush
    this.timer.unref?.();
  }

  private _clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

// ─── Wrapper wiring ───────────────────────────────────────────────────────────

/** "batch" (default): buffer + commitBatch. "per_action": legacy one tx per call */
export type AuditMode = "batch" | "per_action";

export interface BatchOptions {
  /** Share one buffer across several wrappers; other options are then ignored */
  buffer?: BatchBuffer;
  /** Defaults to the SDK signer's address */
  agentAddress?: string;
  store?: BatchStore;
  maxEntries?: number;
  maxAgeSeconds?: number;
  complianceScore?: number;
  onError?: (err: Error) => void;
}

/** Build (or reuse) the buffer a wrapper logs into */
export function resolveBatchBuffer(
  sdk: BatchCommitter & { getAddress(): string },
  options: BatchOptions = {}
): BatchBuffer {
  if (options.buffer) return options.buffer;
  return new BatchBuffer({
    committer: sdk,
    agentAddress: options.agentAddress ?? sdk.getAddress(),
    store: options.store,
    maxEntries: options.maxEntries,
    maxAgeSeconds: options.maxAgeSeconds,
    complianceScore: options.complianceScore,
    onError: options.onError,
  });
}
