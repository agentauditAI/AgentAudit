// AgentAudit AI — Evidence Schema v1 primitives for the standalone verifier:
// JCS (RFC 8785) canonicalization, action_ref and the AuditVault v2 Merkle tree.
// Self-contained on purpose: no import from sdk/ or packages/, so the verifier
// re-derives everything independently of the code that produced the bundle.
// EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)

import { createHash } from "crypto";
import { ethers } from "ethers";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCHEMA = "agentaudit-evidence-v1";
export const LEAF_HASH = "sha256(jcs(preimage))";
export const NODE_HASH = "keccak256(sorted_pair)";
export const ODD_NODE = "promote";

/** The only fields that enter the preimage (docs/EVIDENCE_SCHEMA.md §1.1) */
export const PREIMAGE_FIELDS = ["action_type", "agent_id", "scope", "timestamp_ms"] as const;

const BYTES32_RE = /^0x[0-9a-f]{64}$/;

// ─── JCS (RFC 8785) ───────────────────────────────────────────────────────────

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function jcsString(s: string): string {
  // RFC 8785 §3.2.2.2: strings must be valid Unicode; JSON.stringify's escaping
  // (\b \t \n \f \r \" \\, other C0 as lowercase \u00xx) is exactly JCS's.
  if (hasLoneSurrogate(s)) throw new Error("JCS: string contains a lone surrogate");
  return JSON.stringify(s);
}

/**
 * RFC 8785 canonical JSON. Numbers use ECMAScript Number serialization (what
 * JSON.stringify emits for finite numbers, -0 → 0); object keys are sorted by
 * UTF-16 code units, which is Array.prototype.sort's default order.
 */
export function jcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return jcsString(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => jcsString(k) + ":" + jcs(obj[k])).join(",") + "}";
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

// ─── action_ref ───────────────────────────────────────────────────────────────

/** Why a preimage is not a valid Evidence Schema v1 preimage, or null */
export function preimageProblem(preimage: unknown): string | null {
  if (typeof preimage !== "object" || preimage === null || Array.isArray(preimage)) {
    return "preimage is not an object";
  }
  const p = preimage as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !(PREIMAGE_FIELDS as readonly string[]).includes(k));
  if (extra.length > 0) return `preimage has non-schema field(s): ${extra.join(", ")}`;
  for (const f of ["action_type", "agent_id", "scope"] as const) {
    if (typeof p[f] !== "string") return `preimage.${f} must be a string`;
  }
  if (!Number.isSafeInteger(p.timestamp_ms)) return "preimage.timestamp_ms must be a safe integer";
  return null;
}

/** 0x-prefixed lowercase SHA-256 of the UTF-8 JCS bytes */
export function actionRef(preimage: unknown): string {
  return "0x" + createHash("sha256").update(jcs(preimage), "utf8").digest("hex");
}

// ─── Merkle tree (AuditVault v2) ──────────────────────────────────────────────

/** keccak256(abi.encodePacked(min(a, b), max(a, b))) — AuditVault._verifyMerkle's step */
export function hashPair(a: string, b: string): string {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

function assertLeaves(leaves: string[]): void {
  if (leaves.length === 0) throw new Error("Merkle tree needs at least one leaf");
  for (const l of leaves) {
    if (!BYTES32_RE.test(l)) throw new Error(`leaf is not lowercase 0x-bytes32: ${l}`);
  }
}

/** Every level, leaves first; an unpaired last node is promoted unchanged */
function levels(leaves: string[]): string[][] {
  assertLeaves(leaves);
  const out = [leaves];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    }
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves: string[]): string {
  const lv = levels(leaves);
  return lv[lv.length - 1][0];
}

/** Sibling path for leaves[index]; promoted levels contribute no element */
export function merkleProof(leaves: string[], index: number): string[] {
  const lv = levels(leaves);
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`leaf index ${index} out of range`);
  }
  const proof: string[] = [];
  let i = index;
  for (let d = 0; d < lv.length - 1; d++) {
    const sibling = i ^ 1;
    if (sibling < lv[d].length) proof.push(lv[d][sibling]);
    i >>= 1;
  }
  return proof;
}

/** Local mirror of AuditVault._verifyMerkle */
export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf.toLowerCase();
  for (const p of proof) computed = hashPair(computed, p.toLowerCase());
  return computed === root.toLowerCase();
}
