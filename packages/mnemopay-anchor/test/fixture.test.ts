// Shared fixture fixtures/mnemopay-anchor/v1 — offline checks (no network).

import { readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import {
  AUDIT_VAULT_V2_ABI,
  COMPLIANCE_SCORE,
  anchorContentURI,
  eventCountFromMeta,
  hashProducerId,
  toBytes32Root,
} from "../src/index";
import { attachAnchorReference } from "./vendor/anchor-sink";
import { verifyBundle, type ChainBundle } from "./vendor/audit-chain";

const DIR = path.join(__dirname, "../../../fixtures/mnemopay-anchor/v1");
const bundle: ChainBundle = JSON.parse(readFileSync(path.join(DIR, "bundle.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8"));

describe("fixtures/mnemopay-anchor/v1", () => {
  it("bundle verifies with MnemoPay's verifyBundle and has the expected merkle_root", () => {
    expect(verifyBundle(bundle)).toEqual({ ok: true });
    expect(bundle.merkle_root).toBe(expected.derived.merkle_root);
    expect(toBytes32Root(bundle.merkle_root)).toBe(expected.derived.merkle_root_bytes32);
  });

  it("sealed_at is the bundle's built_at", () => {
    expect(expected.inputs.sealed_at).toBe(bundle.built_at);
  });

  it("producerId hash and contentURI derive from the inputs", () => {
    const { producer_id, namespace, sealed_at } = expected.inputs;
    expect(hashProducerId(producer_id)).toBe(expected.derived.producer_id_sha256);
    expect(anchorContentURI(namespace, producer_id, sealed_at)).toBe(expected.derived.content_uri);
    expect(expected.derived.content_uri).not.toContain(producer_id);
  });

  it("eventCount and complianceScore follow the sink defaults", () => {
    expect(eventCountFromMeta(bundle.meta)).toBe(expected.derived.event_count);
    expect(COMPLIANCE_SCORE).toBe(expected.derived.compliance_score);
  });

  it("commitBatch calldata is byte-identical", () => {
    const calldata = new ethers.Interface(AUDIT_VAULT_V2_ABI).encodeFunctionData("commitBatch", [
      expected.anchor_record.agentId,
      expected.derived.merkle_root_bytes32,
      expected.derived.content_uri,
      expected.derived.event_count,
      expected.derived.compliance_score,
    ]);
    expect(calldata).toBe(expected.derived.commit_batch_calldata);
  });

  it("anchor reference, record and anchored meta are mutually consistent", () => {
    const { anchor_reference: ref, anchor_record: rec } = expected;
    expect(ref).toEqual({ chain: rec.chain, txHash: rec.txHash, rootCommitment: rec.rootCommitment });
    expect(rec.rootCommitment).toBe(bundle.merkle_root);
    expect(rec.contentURI).toBe(expected.derived.content_uri);
    expect(rec.eventCount).toBe(expected.derived.event_count);
    expect(rec.complianceScore).toBe(expected.derived.compliance_score);
  });

  it("attaching the reference reproduces anchored_bundle_meta and still verifies", () => {
    const anchored = attachAnchorReference(bundle, expected.anchor_reference);
    expect(anchored.meta).toEqual(expected.anchored_bundle_meta);
    expect(verifyBundle(anchored)).toEqual({ ok: true });
    expect(verifyBundle(JSON.parse(JSON.stringify(anchored)))).toEqual({ ok: true });
  });
});
