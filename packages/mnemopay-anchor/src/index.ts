// AgentAudit AI — on-chain anchor sink backed by AuditVault v2 commitBatch.
// Implements the OnChainAnchorSink seam of @mnemopay/sdk (governance/anchor-sink)
// but anchors any 32-byte Merkle root; nothing here depends on MnemoPay at runtime.
// EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)

import { createHash } from "crypto";
import { ethers } from "ethers";

// ─── Types ────────────────────────────────────────────────────────────────────
// Structurally identical to @mnemopay/sdk/governance (anchor-sink.ts). Declared
// here so the package has no runtime or build-time dependency on the SDK;
// test/types.compat.ts asserts assignability against the upstream definitions.

export interface AnchorRequest {
  producerId: string;
  merkleRoot: string;
  bundleMeta: Record<string, unknown>;
  sealedAt: string;
}

export interface AnchorHandle {
  anchorId: string;
}

export interface AnchorReference {
  chain: string;
  txHash: string;
  rootCommitment: string;
}

export type AnchorStatus =
  | { state: "pending" }
  | ({ state: "anchored" } & AnchorReference)
  | { state: "failed"; reason: string };

export interface OnChainAnchorSink {
  anchor(input: AnchorRequest): Promise<AnchorHandle>;
  status(anchorId: string): Promise<AnchorStatus>;
}

export interface AuditVaultAnchorSinkOptions {
  /** Opaque medium name reported back in AnchorReference.chain, e.g. "base" */
  chain: string;
  rpcUrl: string;
  /** Deployed AuditVault v2 address on that chain */
  vaultAddress: string;
  /** Pays gas; its address is also used as the commitBatch agentId */
  signer: ethers.Signer;
  /** contentURI namespace, default "mnemopay"; must not contain ":" */
  namespace?: string;
  /** Blocks (including the inclusion block) before status() reports anchored; default 1 */
  confirmations?: number;
  /** status() gives up on a slow or unreachable RPC after this long and reports pending; default 10000 */
  statusTimeoutMs?: number;
}

/** Everything a verifier needs to find the anchor on-chain */
export interface AnchorRecord extends AnchorReference {
  vaultAddress: string;
  agentId: string;
  batchIndex: number;
  blockNumber: number;
  contentURI: string;
  eventCount: number;
  complianceScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const AUDIT_VAULT_V2_ABI = [
  "function commitBatch(address agentId, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore)",
  "event LogBatchCommitted(address indexed agentId, uint256 indexed batchIndex, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore, uint256 timestamp)",
];

export const DEFAULT_NAMESPACE = "mnemopay";

/** Unscored — same convention as AuditVault.commitHighRiskEvent */
export const COMPLIANCE_SCORE = 0;

const ROOT_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ROOT = "0".repeat(64);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lowercase hex SHA-256 of the UTF-8 producerId — the only form that goes on-chain */
export function hashProducerId(producerId: string): string {
  return createHash("sha256").update(producerId, "utf8").digest("hex");
}

/** <namespace>:<sha256(producerId)>:<sealedAt> */
export function anchorContentURI(namespace: string, producerId: string, sealedAt: string): string {
  return `${namespace}:${hashProducerId(producerId)}:${sealedAt}`;
}

/** Accepts bare or 0x-prefixed 64-hex; returns 0x-prefixed lowercase bytes32 */
export function toBytes32Root(merkleRoot: string): string {
  if (typeof merkleRoot !== "string" || !ROOT_RE.test(merkleRoot)) {
    throw new Error("merkleRoot must be a 32-byte hex string (64 hex chars, optional 0x)");
  }
  const hex = merkleRoot.replace(/^0x/, "").toLowerCase();
  if (hex === ZERO_ROOT) throw new Error("merkleRoot must not be zero");
  return "0x" + hex;
}

/** bundleMeta.event_count when it is a positive safe integer, else 1 (one root) */
export function eventCountFromMeta(meta: Record<string, unknown> | undefined): number {
  const n = meta?.event_count;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 1;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Sink ─────────────────────────────────────────────────────────────────────

/**
 * Anchors a Merkle root with AuditVault v2 `commitBatch` and resolves it by
 * transaction receipt. `anchorId` is the transaction hash, so status() keeps
 * no state beyond the set of hashes this instance broadcast.
 *
 * An anchor proves the root existed on-chain at block T. v2 commitBatch does not
 * authenticate the submitter, so it does not prove who committed it.
 */
export class AuditVaultAnchorSink implements OnChainAnchorSink {
  readonly chain: string;
  readonly vaultAddress: string;
  readonly namespace: string;
  readonly confirmations: number;
  readonly statusTimeoutMs: number;
  /** Last RPC error or timeout seen by status(); cleared on the next successful lookup */
  lastStatusError: string | null = null;

  private readonly provider: ethers.JsonRpcProvider;
  private readonly signer: ethers.Signer;
  private readonly vault: ethers.Contract;
  private readonly iface = new ethers.Interface(AUDIT_VAULT_V2_ABI);
  private readonly broadcast = new Set<string>();
  // Serialises sends so concurrent anchor() calls don't race on the nonce
  private sendQueue: Promise<unknown> = Promise.resolve();

  constructor(opts: AuditVaultAnchorSinkOptions) {
    if (!opts || typeof opts.chain !== "string" || opts.chain.length === 0) {
      throw new Error("AuditVaultAnchorSink: chain is required");
    }
    if (typeof opts.rpcUrl !== "string" || opts.rpcUrl.length === 0) {
      throw new Error("AuditVaultAnchorSink: rpcUrl is required");
    }
    if (typeof opts.vaultAddress !== "string" || !ethers.isAddress(opts.vaultAddress)) {
      throw new Error("AuditVaultAnchorSink: vaultAddress must be a valid address");
    }
    if (!opts.signer) throw new Error("AuditVaultAnchorSink: signer is required");
    const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    if (namespace.length === 0 || namespace.includes(":")) {
      throw new Error('AuditVaultAnchorSink: namespace must be non-empty and must not contain ":"');
    }
    const confirmations = opts.confirmations ?? 1;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) {
      throw new Error("AuditVaultAnchorSink: confirmations must be an integer >= 1");
    }
    const statusTimeoutMs = opts.statusTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(statusTimeoutMs) || statusTimeoutMs < 1) {
      throw new Error("AuditVaultAnchorSink: statusTimeoutMs must be an integer >= 1");
    }

    this.chain = opts.chain;
    this.vaultAddress = ethers.getAddress(opts.vaultAddress);
    this.namespace = namespace;
    this.confirmations = confirmations;
    this.statusTimeoutMs = statusTimeoutMs;
    // cacheTimeout -1: status() polls, so a 250 ms-cached block number would
    // under-count confirmations right after inclusion
    this.provider = new ethers.JsonRpcProvider(opts.rpcUrl, undefined, { cacheTimeout: -1 });
    this.signer = opts.signer.provider ? opts.signer : opts.signer.connect(this.provider);
    this.vault = new ethers.Contract(this.vaultAddress, AUDIT_VAULT_V2_ABI, this.signer);
  }

  /** Broadcasts commitBatch and returns its tx hash without waiting for inclusion */
  async anchor(input: AnchorRequest): Promise<AnchorHandle> {
    if (!input || typeof input.producerId !== "string" || input.producerId.length === 0) {
      throw new Error("AuditVaultAnchorSink.anchor: producerId is required");
    }
    if (typeof input.sealedAt !== "string" || input.sealedAt.length === 0) {
      throw new Error("AuditVaultAnchorSink.anchor: sealedAt is required");
    }
    const root = toBytes32Root(input.merkleRoot);
    const contentURI = anchorContentURI(this.namespace, input.producerId, input.sealedAt);
    const eventCount = eventCountFromMeta(input.bundleMeta);

    const send = this.sendQueue.then(async () => {
      const agentId = await this.signer.getAddress();
      const tx = await this.vault.commitBatch(agentId, root, contentURI, eventCount, COMPLIANCE_SCORE);
      return tx.hash as string;
    });
    this.sendQueue = send.catch(() => undefined);
    const txHash = await send;
    this.broadcast.add(txHash.toLowerCase());
    return { anchorId: txHash };
  }

  /**
   * Never throws. Unknown or malformed ids resolve to failed. RPC errors and
   * timeouts are transient, so they resolve to pending (see lastStatusError).
   */
  async status(anchorId: string): Promise<AnchorStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${this.statusTimeoutMs} ms`)), this.statusTimeoutMs);
      });
      const result = await Promise.race([this.resolve(anchorId), timeout]);
      this.lastStatusError = null;
      if (result.state !== "anchored") return result;
      return {
        state: "anchored",
        chain: result.record.chain,
        txHash: result.record.txHash,
        rootCommitment: result.record.rootCommitment,
      };
    } catch (err) {
      this.lastStatusError = errorMessage(err);
      return { state: "pending" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Full on-chain record for an anchored id; null while pending or failed */
  async getAnchorRecord(anchorId: string): Promise<AnchorRecord | null> {
    const result = await this.resolve(anchorId);
    return result.state === "anchored" ? result.record : null;
  }

  /** Releases the JSON-RPC provider (polling timers, sockets) */
  destroy(): void {
    this.provider.destroy();
  }

  private async resolve(
    anchorId: string,
  ): Promise<{ state: "pending" } | { state: "failed"; reason: string } | { state: "anchored"; record: AnchorRecord }> {
    if (typeof anchorId !== "string" || !TX_HASH_RE.test(anchorId)) {
      return { state: "failed", reason: `unknown anchorId: ${String(anchorId)}` };
    }
    const receipt = await this.provider.getTransactionReceipt(anchorId);
    if (!receipt) {
      // Our own broadcast stays pending (RPC lag or still in the mempool; a
      // dropped tx stays pending forever). Anything else is an unknown handle.
      if (this.broadcast.has(anchorId.toLowerCase())) return { state: "pending" };
      if (await this.provider.getTransaction(anchorId)) return { state: "pending" };
      return { state: "failed", reason: `unknown anchorId: transaction ${anchorId} not found on ${this.chain}` };
    }
    if (receipt.status !== 1) {
      return { state: "failed", reason: `commitBatch reverted in block ${receipt.blockNumber}` };
    }
    if ((await receipt.confirmations()) < this.confirmations) return { state: "pending" };

    for (const log of receipt.logs) {
      if (ethers.getAddress(log.address) !== this.vaultAddress) continue;
      const parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "LogBatchCommitted") continue;
      return {
        state: "anchored",
        record: {
          chain: this.chain,
          txHash: receipt.hash,
          rootCommitment: (parsed.args.merkleRoot as string).slice(2).toLowerCase(),
          vaultAddress: this.vaultAddress,
          agentId: ethers.getAddress(parsed.args.agentId as string),
          batchIndex: Number(parsed.args.batchIndex),
          blockNumber: receipt.blockNumber,
          contentURI: parsed.args.contentURI as string,
          eventCount: Number(parsed.args.eventCount),
          complianceScore: Number(parsed.args.complianceScore),
        },
      };
    }
    return {
      state: "failed",
      reason: `transaction ${anchorId} did not emit LogBatchCommitted from ${this.vaultAddress}`,
    };
  }
}
