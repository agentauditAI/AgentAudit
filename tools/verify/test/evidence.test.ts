// Offline checks of the verifier's primitives against the repo's existing
// fixtures, read byte-for-byte as committed (no fixture is modified).

import { createHash } from "crypto";
import { readFileSync } from "fs";
import * as path from "path";
import { actionRef, jcs, merkleProof, merkleRoot, preimageProblem, verifyProof } from "../src/evidence";

const ROOT = path.join(__dirname, "../../..");
const DEMO = path.join(ROOT, "docs/demo/first-anchor-bundle.json");
const MNEMOPAY = path.join(ROOT, "fixtures/mnemopay-anchor/v1");

const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("fixtures are byte-identical", () => {
  // Pinned so a "fix" to a fixture cannot slip in alongside verifier changes
  it.each([
    [DEMO, "70eeb85a67867bb79093a68454bcf0ded03fea5b5d308756620c2b18642cfc00"],
    [path.join(MNEMOPAY, "bundle.json"), "6d049e5199f6792156df27b8e9dd0a2626aa5b77927480a1efa13353bbdb280a"],
    [path.join(MNEMOPAY, "expected.json"), "17ab666813b9c05280bf594bd101e5160887815bdfa83725ff9f5bdb321330d3"],
    [path.join(MNEMOPAY, "README.md"), "6902d4af5f41bba6bb3a66b05e552f2f7ff4e01f901225b1c26241ca48a76df3"],
  ])("%s", (file, digest) => {
    expect(sha256File(file)).toBe(digest);
  });
});

describe("JCS (RFC 8785)", () => {
  it("sorts keys by UTF-16 code units and drops whitespace", () => {
    // U+20AC (0x20AC) sorts before U+1F600 (surrogates 0xD83D…) in UTF-16 order
    expect(jcs({ b: 1, a: [true, null], "\u{1F600}": 0, "€": 0 })).toBe('{"a":[true,null],"b":1,"€":0,"😀":0}');
  });

  it("serializes numbers like ECMAScript (RFC 8785 §3.2.2.3 samples)", () => {
    expect(jcs([0, -0, 1e21, 1e-7, 333333333.3333333, 4.5, 2e-3, 0.000001])).toBe(
      "[0,0,1e+21,1e-7,333333333.3333333,4.5,0.002,0.000001]",
    );
  });

  it("escapes strings minimally", () => {
    expect(jcs("\u0000\b\t\n\f\r\"\\/\u001f\u007f")).toBe('"\\u0000\\b\\t\\n\\f\\r\\"\\\\/\\u001f\u007f"');
  });

  it("rejects values JCS cannot represent", () => {
    expect(() => jcs(NaN)).toThrow("non-finite");
    expect(() => jcs(Infinity)).toThrow("non-finite");
    expect(() => jcs("\ud800")).toThrow("lone surrogate");
    expect(() => jcs({ ["\udc00"]: 1 })).toThrow("lone surrogate");
    expect(() => jcs(undefined)).toThrow("unsupported type");
    expect(() => jcs(1n)).toThrow("unsupported type");
  });
});

describe("action_ref", () => {
  it("matches the docs/EVIDENCE_SCHEMA.md §1.2 example", () => {
    const preimage = JSON.parse(
      '{"action_type":"tool_call","agent_id":"agentaudit-example-agent","scope":"tool_call:web_search:result_hash:97e2255a47d3fa064bc6f02b70898dbc96ff64bb840b8a2d56b36d9e98b2e681","timestamp_ms":1761264000000}',
    );
    expect(actionRef(preimage)).toBe("0x42de5ecdb20e72e6f038c44c911870aac6200bb67db331b253bc8b794d5ffdad");
  });

  it("recomputes every action_ref and the merkle_root of the demo bundle exactly", () => {
    const bundle = JSON.parse(readFileSync(DEMO, "utf8"));
    const refs = bundle.entries.map((e: { preimage: unknown }) => actionRef(e.preimage));
    expect(refs).toEqual(bundle.entries.map((e: { action_ref: string }) => e.action_ref));
    expect(merkleRoot(refs)).toBe(bundle.merkle_root);
    expect(merkleRoot(refs).slice(2)).toBe(bundle.meta.anchor.rootCommitment);
  });

  it("is independent of key order in the presented preimage", () => {
    const a = { timestamp_ms: 1, scope: "s", agent_id: "a", action_type: "t" };
    const b = { action_type: "t", agent_id: "a", scope: "s", timestamp_ms: 1 };
    expect(actionRef(a)).toBe(actionRef(b));
  });

  it("preimageProblem enforces the four schema fields", () => {
    const ok = { action_type: "t", agent_id: "a", scope: "s", timestamp_ms: 1 };
    expect(preimageProblem(ok)).toBeNull();
    expect(preimageProblem(null)).toBe("preimage is not an object");
    expect(preimageProblem([ok])).toBe("preimage is not an object");
    expect(preimageProblem({ ...ok, verdict: "ALLOW" })).toBe("preimage has non-schema field(s): verdict");
    expect(preimageProblem({ ...ok, scope: 1 })).toBe("preimage.scope must be a string");
    expect(preimageProblem({ ...ok, timestamp_ms: 1.5 })).toBe("preimage.timestamp_ms must be a safe integer");
    expect(preimageProblem({ ...ok, timestamp_ms: 2 ** 53 })).toBe("preimage.timestamp_ms must be a safe integer");
  });
});

describe("Merkle tree (AuditVault v2 rules)", () => {
  const leaf = (i: number) => actionRef({ action_type: "t", agent_id: "a", scope: `s${i}`, timestamp_ms: i });

  it("single leaf: root == leaf, empty proof", () => {
    expect(merkleRoot([leaf(0)])).toBe(leaf(0));
    expect(merkleProof([leaf(0)], 0)).toEqual([]);
  });

  it("promotes an unpaired last node without duplicating it", () => {
    const l = [leaf(0), leaf(1), leaf(2)];
    // 3 leaves: the third is promoted, so its proof has one node (the pair hash)
    expect(merkleProof(l, 2)).toHaveLength(1);
    expect(merkleProof(l, 0)).toHaveLength(2);
  });

  it.each([1, 2, 3, 4, 5, 7, 8, 9, 16, 17])("every proof verifies for %i leaves", (n) => {
    const l = Array.from({ length: n }, (_, i) => leaf(i));
    const root = merkleRoot(l);
    for (let i = 0; i < n; i++) expect(verifyProof(l[i], merkleProof(l, i), root)).toBe(true);
  });

  it("a proof for one leaf does not verify another", () => {
    const l = [leaf(0), leaf(1), leaf(2), leaf(3)];
    expect(verifyProof(l[0], merkleProof(l, 2), merkleRoot(l))).toBe(false);
  });

  it("rejects bad input", () => {
    expect(() => merkleRoot([])).toThrow("at least one leaf");
    expect(() => merkleRoot(["0x1234"])).toThrow("not lowercase 0x-bytes32");
    expect(() => merkleProof([leaf(0)], 1)).toThrow("out of range");
  });
});
