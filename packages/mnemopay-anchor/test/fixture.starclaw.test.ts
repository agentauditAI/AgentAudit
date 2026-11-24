// Shared fixture fixtures/starclaw-chainbundle/v1 (vendored from StarClaw, see
// its PROVENANCE.md) — offline checks (no network).

import { createHash, createPublicKey, verify, type KeyObject } from "crypto";
import { readFileSync } from "fs";
import * as path from "path";
import { anchorContentURI, eventCountFromMeta, hashProducerId, toBytes32Root } from "../src/index";
import { verifyBundle, type ChainBundle } from "./vendor/audit-chain";

const DIR = path.join(__dirname, "../../../fixtures/starclaw-chainbundle/v1");
const raw = readFileSync(path.join(DIR, "chain-bundle.json"));
const bundle: ChainBundle = JSON.parse(raw.toString("utf8"));
const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8"));

const PRODUCER_ID = "starclaw/fixture";
const ZERO_HASH = "0".repeat(64);
// DER SPKI prefix for a raw 32-byte Ed25519 public key (RFC 8410)
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

interface StarClawLink {
  seq: number;
  prev: string;
  hash: string;
  sig: string;
}

function starclaw(i: number): StarClawLink {
  return (bundle.events[i]!.payload as { starclaw: StarClawLink }).starclaw;
}

function ed25519PublicKey(hex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

describe("fixtures/starclaw-chainbundle/v1", () => {
  it("chain-bundle.json bytes match the pinned sha256", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(expected.chain_bundle_sha256);
    expect(raw.includes(0x0d)).toBe(false); // LF only
  });

  it("bundle verifies with MnemoPay's verifyBundle and has the expected merkle_root", () => {
    expect(verifyBundle(bundle)).toEqual({ ok: true });
    expect(bundle.merkle_root).toBe(expected.merkle_root);
    expect(bundle.events).toHaveLength(5);
    expect(bundle.events).toHaveLength(expected.events);
    expect(bundle.built_at).toBe(expected.built_at);
  });

  it("a bundle with one tampered event payload is rejected", () => {
    const tampered: ChainBundle = JSON.parse(raw.toString("utf8"));
    (tampered.events[1]!.payload as { data: { goal: string } }).data.goal = "something else";
    expect(verifyBundle(tampered)).toEqual({ ok: false, reason: "root_mismatch" });
  });

  it("merkle_root converts to the bytes32 the sink anchors", () => {
    expect(toBytes32Root(bundle.merkle_root)).toBe("0x" + expected.merkle_root);
  });

  it("eventCount falls back to the sink default of 1", () => {
    // StarClaw's meta records log_records but no event_count, so the sink
    // anchors one root (eventCount 1) — the documented eventCountFromMeta default.
    expect(bundle.meta).not.toHaveProperty("event_count");
    expect(eventCountFromMeta(bundle.meta)).toBe(1);
  });

  it("contentURI carries the producerId hash, not the raw producerId", () => {
    const uri = anchorContentURI("mnemopay", PRODUCER_ID, bundle.built_at);
    expect(uri).toBe(`mnemopay:${hashProducerId(PRODUCER_ID)}:${bundle.built_at}`);
    expect(uri).not.toContain(PRODUCER_ID);
  });

  it("StarClaw hash chain links every event and ends at meta.log_last_hash", () => {
    let prev = ZERO_HASH;
    bundle.events.forEach((ev, i) => {
      const link = starclaw(i);
      expect(link.seq).toBe(ev.sequence);
      expect(link.prev).toBe(prev);
      prev = link.hash;
    });
    expect(prev).toBe(bundle.meta.log_last_hash);
  });

  it("every StarClaw signature is a valid Ed25519 signature over the hash hex", () => {
    expect(readFileSync(path.join(DIR, "pubkey.txt"), "utf8").trim()).toBe(expected.public_key_hex);
    expect(bundle.meta.public_key_hex).toBe(expected.public_key_hex);
    const key = ed25519PublicKey(expected.public_key_hex);
    bundle.events.forEach((_, i) => {
      const { hash, sig } = starclaw(i);
      expect(verify(null, Buffer.from(hash, "utf8"), key, Buffer.from(sig, "base64"))).toBe(true);
    });
  });

  it("a signature does not verify over a different hash", () => {
    const key = ed25519PublicKey(expected.public_key_hex);
    const { sig } = starclaw(0);
    expect(verify(null, Buffer.from(starclaw(1).hash, "utf8"), key, Buffer.from(sig, "base64"))).toBe(false);
  });
});
