import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { ethers } from "ethers";
import {
  BatchBuffer,
  FileBatchStore,
  MemoryBatchStore,
  buildMerkleLevels,
  canonicalize,
  computeActionRef,
  dataReadScope,
  encodeScopeSegment,
  hashPair,
  llmCallScope,
  llmDecisionPreimage,
  merkleProof,
  merkleRoot,
  sha256Hex,
  toolCallScope,
  verifyMerkleProof,
  type ActionPreimage,
  type BatchCommitter,
  type CommitBatchParams,
} from "../../sdk/src/batch";

// ─── Fixtures: vectors from test/AuditVaultActionRef.t.sol ───────────────────

const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const VECTORS: Array<{ preimage: ActionPreimage; ref: string }> = [
  {
    preimage: { action_type: "send_email", agent_id: "nobulex-test-agent", scope: "user@example.com", timestamp_ms: 1748000000000 },
    ref: "0x86bdb19ed2ee90065ca9fbeaf597075ea03abab6ff01027d457239b9c7c5809b",
  },
  {
    preimage: { action_type: "delete_database", agent_id: "nobulex-test-agent", scope: "production", timestamp_ms: 1748000001000 },
    ref: "0xae036c69337e09fcaab63d3ebc77e9a1d80a1f019a830815890c43bf1bd79d4f",
  },
  {
    preimage: { action_type: "transfer_funds", agent_id: "nobulex-test-agent", scope: "100_USDC", timestamp_ms: 1748000002000 },
    ref: "0xdd0a1ec0afdcdfd4be7eb45404449ecdb7f697b01d707a06a32305fc05fadf75",
  },
  {
    preimage: { action_type: "transfer_funds", agent_id: "nobulex-test-agent", scope: "500_USDC_to_vendor", timestamp_ms: 1748000003000 },
    ref: "0x57c4990825b8be98f326acf8065a43280f51e2c6727ffd9bdb14c62eff6985da",
  },
  {
    // docs/EVIDENCE_SCHEMA.md §1.2 worked example
    preimage: {
      action_type: "tool_call",
      agent_id: "agentaudit-example-agent",
      scope: "tool_call:web_search:result_hash:97e2255a47d3fa064bc6f02b70898dbc96ff64bb840b8a2d56b36d9e98b2e681",
      timestamp_ms: 1761264000000,
    },
    ref: "0x42de5ecdb20e72e6f038c44c911870aac6200bb67db331b253bc8b794d5ffdad",
  },
];

function preimage(i: number): ActionPreimage {
  return { action_type: "LLM_DECISION", agent_id: "7", scope: `llm_call:m:record_hash:${sha256Hex(String(i))}`, timestamp_ms: 1761264000000 + i };
}

function makeCommitter() {
  let n = 0;
  const calls: CommitBatchParams[] = [];
  const committer: BatchCommitter & { calls: CommitBatchParams[] } = {
    calls,
    commitBatch: jest.fn(async (p: CommitBatchParams) => {
      calls.push(p);
      return { txHash: `0xtx${n}`, batchIndex: n++ };
    }),
  };
  return committer;
}

afterEach(() => {
  jest.useRealTimers();
});

// ─── JCS + action_ref ─────────────────────────────────────────────────────────

describe("canonicalize (RFC 8785)", () => {
  it("sorts keys by UTF-16 code units (RFC 8785 §3.2.3 example order)", () => {
    const obj = { "\u20ac": 1, "\r": 2, "\ufb33": 3, "1": 4, "\ud83d\ude00": 5, "\u0080": 6, "\u00f6": 7 };
    expect(canonicalize(obj)).toBe('{"\\r":2,"1":4,"\u0080":6,"\u00f6":7,"\u20ac":1,"\ud83d\ude00":5,"\ufb33":3}');
  });

  it("serializes numbers like ECMAScript", () => {
    expect(canonicalize([1e21, 1e-7, -0, 0.1, 333333333.3333333])).toBe("[1e+21,1e-7,0,0.1,333333333.3333333]");
  });

  it("drops undefined members and nests recursively", () => {
    expect(canonicalize({ b: [true, null, { d: 1, c: "x" }], a: undefined })).toBe('{"b":[true,null,{"c":"x","d":1}]}');
  });

  it("rejects non-finite numbers and unsupported types", () => {
    expect(() => canonicalize(NaN)).toThrow("non-finite");
    expect(() => canonicalize(Infinity)).toThrow("non-finite");
    expect(() => canonicalize(BigInt(1))).toThrow("unsupported");
  });
});

describe("computeActionRef", () => {
  it.each(VECTORS.map((v, i) => [i, v]))("matches fixture vector %i", (_i, v) => {
    expect(computeActionRef(v.preimage)).toBe(v.ref);
  });

  it("is independent of key order", () => {
    const p = VECTORS[0].preimage;
    const reordered = { timestamp_ms: p.timestamp_ms, scope: p.scope, agent_id: p.agent_id, action_type: p.action_type };
    expect(computeActionRef(reordered)).toBe(VECTORS[0].ref);
  });

  it("ignores envelope fields such as verdict or policy_version", () => {
    const withEnvelope = { ...VECTORS[2].preimage, verdict: "ALLOW", policy_version: "risk-policy-v2.1" } as ActionPreimage;
    expect(computeActionRef(withEnvelope)).toBe(VECTORS[2].ref);
  });

  it("rejects a non-integer timestamp_ms", () => {
    expect(() => computeActionRef({ ...VECTORS[0].preimage, timestamp_ms: 1.5 })).toThrow("timestamp_ms");
  });
});

describe("scope helpers", () => {
  it("percent-encodes ':' and '%' in segments", () => {
    expect(encodeScopeSegment("bedrock:claude%v1")).toBe("bedrock%3Aclaude%25v1");
  });

  it("builds §2.1 / §2.2 / §2.3 formats", () => {
    const h = sha256Hex("x");
    expect(toolCallScope("web_search", h)).toBe(`tool_call:web_search:result_hash:${h}`);
    expect(dataReadScope("/v1/prices", "2026-10-01", h)).toBe(`data_read:/v1/prices:2026-10-01:${h}`);
    expect(llmCallScope("anthropic.claude:0", { b: 1, a: 2 })).toBe(
      `llm_call:anthropic.claude%3A0:record_hash:${sha256Hex('{"a":2,"b":1}')}`
    );
  });

  it("llmDecisionPreimage uses LLM_DECISION and a string agent_id", () => {
    const p = llmDecisionPreimage(7, "gpt-4o", { a: 1 }, 123);
    expect(p).toEqual({
      action_type: "LLM_DECISION",
      agent_id: "7",
      scope: `llm_call:gpt-4o:record_hash:${sha256Hex('{"a":1}')}`,
      timestamp_ms: 123,
    });
  });
});

// ─── Merkle tree ─────────────────────────────────────────────────────────────

describe("Merkle tree", () => {
  // Solidity-equivalent reference: keccak256(abi.encodePacked(min, max))
  const solPair = (a: string, b: string) =>
    BigInt(a) <= BigInt(b)
      ? ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [a, b])
      : ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [b, a]);

  it("4-leaf root equals AuditVaultActionRef.t.sol _buildTree()", () => {
    const [r1, r2, r3, r4] = VECTORS.slice(0, 4).map((v) => v.ref);
    expect(merkleRoot([r1, r2, r3, r4])).toBe(solPair(solPair(r1, r2), solPair(r3, r4)));
  });

  it("hashPair is commutative", () => {
    expect(hashPair(VECTORS[0].ref, VECTORS[1].ref)).toBe(hashPair(VECTORS[1].ref, VECTORS[0].ref));
  });

  it("promotes an unpaired last node (5 leaves)", () => {
    const refs = VECTORS.map((v) => v.ref);
    const expected = solPair(solPair(solPair(refs[0], refs[1]), solPair(refs[2], refs[3])), refs[4]);
    expect(merkleRoot(refs)).toBe(expected);
    const levels = buildMerkleLevels(refs);
    expect(merkleProof(levels, 4)).toEqual([solPair(solPair(refs[0], refs[1]), solPair(refs[2], refs[3]))]);
  });

  it("single leaf: root is the leaf and the proof is empty", () => {
    const levels = buildMerkleLevels([VECTORS[0].ref]);
    expect(levels[levels.length - 1][0]).toBe(VECTORS[0].ref);
    expect(merkleProof(levels, 0)).toEqual([]);
  });

  it("every proof verifies for tree sizes 1..33", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = Array.from({ length: n }, (_, i) => computeActionRef(preimage(i)));
      const levels = buildMerkleLevels(leaves);
      const root = levels[levels.length - 1][0];
      leaves.forEach((leaf, i) => {
        expect(verifyMerkleProof(leaf, merkleProof(levels, i), root)).toBe(true);
      });
    }
  });

  it("rejects a tampered proof or a foreign leaf", () => {
    const refs = VECTORS.map((v) => v.ref);
    const levels = buildMerkleLevels(refs);
    const root = merkleRoot(refs);
    const proof = merkleProof(levels, 1);
    expect(verifyMerkleProof(refs[1], [ethers.ZeroHash, ...proof.slice(1)], root)).toBe(false);
    expect(verifyMerkleProof(computeActionRef(preimage(99)), proof, root)).toBe(false);
  });

  it("rejects empty trees, malformed leaves and out-of-range indexes", () => {
    expect(() => buildMerkleLevels([])).toThrow("at least one leaf");
    expect(() => buildMerkleLevels(["0x1234"])).toThrow("bytes32");
    expect(() => merkleProof(buildMerkleLevels([VECTORS[0].ref]), 1)).toThrow("out of range");
  });
});

// ─── BatchBuffer ─────────────────────────────────────────────────────────────

describe("BatchBuffer", () => {
  it("flushes when maxEntries is reached", async () => {
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxEntries: 3 });

    await buffer.add(preimage(0));
    await buffer.add(preimage(1));
    expect(committer.commitBatch).not.toHaveBeenCalled();
    expect(buffer.size).toBe(2);

    await buffer.add(preimage(2));
    expect(committer.commitBatch).toHaveBeenCalledTimes(1);
    expect(buffer.size).toBe(0);
    expect(committer.calls[0]).toMatchObject({ agentAddress: AGENT, eventCount: 3, complianceScore: 0 });
    expect(committer.calls[0].merkleRoot).toBe(merkleRoot([0, 1, 2].map((i) => computeActionRef(preimage(i)))));
  });

  it("defaults to 50 entries per batch", async () => {
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT });
    for (let i = 0; i < 49; i++) await buffer.add(preimage(i));
    expect(committer.commitBatch).not.toHaveBeenCalled();
    await buffer.add(preimage(49));
    expect(committer.calls[0].eventCount).toBe(50);
  });

  it("flushes maxAgeSeconds after the first entry", async () => {
    jest.useFakeTimers();
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxAgeSeconds: 60 });

    await buffer.add(preimage(0));
    await jest.advanceTimersByTimeAsync(30_000);
    await buffer.add(preimage(1)); // must not restart the clock
    await jest.advanceTimersByTimeAsync(29_999);
    expect(committer.commitBatch).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(committer.commitBatch).toHaveBeenCalledTimes(1);
    expect(committer.calls[0].eventCount).toBe(2);
  });

  it("does not arm a timer while empty", async () => {
    jest.useFakeTimers();
    const committer = makeCommitter();
    new BatchBuffer({ committer, agentAddress: AGENT, maxAgeSeconds: 1 });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(committer.commitBatch).not.toHaveBeenCalled();
  });

  it("flush() anchors immediately and returns the batch; empty flush returns null", async () => {
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT });
    expect(await buffer.flush()).toBeNull();

    const { actionRef } = await buffer.add(preimage(0));
    const result = await buffer.flush();
    expect(result).toEqual({
      batchId: actionRef,
      merkleRoot: actionRef,
      contentURI: `memory://${actionRef}`,
      eventCount: 1,
      txHash: "0xtx0",
      batchIndex: 0,
    });
    expect(committer.commitBatch).toHaveBeenCalledTimes(1);
  });

  it("close() flushes the remainder and cancels the timer", async () => {
    jest.useFakeTimers();
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxAgeSeconds: 60 });
    await buffer.add(preimage(0));
    await buffer.close();
    expect(committer.commitBatch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(committer.commitBatch).toHaveBeenCalledTimes(1);
  });

  it("getInclusionProof returns a proof that verifies against the committed root", async () => {
    const committer = makeCommitter();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxEntries: 5 });
    const refs: string[] = [];
    for (const v of VECTORS) refs.push((await buffer.add(v.preimage)).actionRef);

    for (const ref of refs) {
      const p = buffer.getInclusionProof(ref)!;
      expect(p.leaf).toBe(ref);
      expect(p.root).toBe(committer.calls[0].merkleRoot);
      expect(p.batchId).toBe(p.root);
      expect(p.batchIndex).toBe(0);
      expect(p.agentAddress).toBe(AGENT);
      expect(verifyMerkleProof(p.leaf, p.proof, p.root)).toBe(true);
    }
  });

  it("getInclusionProof returns null for pending or unknown refs", async () => {
    const buffer = new BatchBuffer({ committer: makeCommitter(), agentAddress: AGENT });
    const { actionRef } = await buffer.add(preimage(0));
    expect(buffer.getInclusionProof(actionRef)).toBeNull();
    expect(buffer.getInclusionProof(ethers.ZeroHash)).toBeNull();
  });

  it("re-queues entries when the commit fails, then succeeds on retry", async () => {
    const committer = makeCommitter();
    (committer.commitBatch as jest.Mock).mockRejectedValueOnce(new Error("rpc down"));
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxEntries: 2 });

    await buffer.add(preimage(0));
    await expect(buffer.add(preimage(1))).rejects.toThrow("rpc down");
    expect(buffer.size).toBe(2);

    await buffer.add(preimage(2));
    expect(committer.calls[0].eventCount).toBe(3);
    expect(committer.calls[0].merkleRoot).toBe(merkleRoot([0, 1, 2].map((i) => computeActionRef(preimage(i)))));
  });

  it("reports timer-triggered flush failures to onError", async () => {
    jest.useFakeTimers();
    const committer = makeCommitter();
    (committer.commitBatch as jest.Mock).mockRejectedValueOnce(new Error("rpc down"));
    const onError = jest.fn();
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, maxAgeSeconds: 1, onError });

    await buffer.add(preimage(0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "rpc down" }));
    expect(buffer.size).toBe(1);

    await jest.advanceTimersByTimeAsync(1000); // re-armed → retried
    expect(committer.commitBatch).toHaveBeenCalledTimes(2);
    expect(buffer.size).toBe(0);
  });

  it("entries added while a commit is in flight go into the next batch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const commitStarted = new Promise<void>((r) => (started = r));
    const committer = makeCommitter();
    (committer.commitBatch as jest.Mock).mockImplementationOnce(async (p: CommitBatchParams) => {
      started();
      await gate;
      committer.calls.push(p);
      return { txHash: "0xslow", batchIndex: 0 };
    });
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT });

    await buffer.add(preimage(0));
    const first = buffer.flush();
    await commitStarted;
    await buffer.add(preimage(1));
    const second = buffer.flush();
    release();
    await Promise.all([first, second]);

    expect(committer.calls.map((c) => c.eventCount)).toEqual([1, 1]);
    expect(committer.calls[0].merkleRoot).not.toBe(committer.calls[1].merkleRoot);
  });

  it("stores the batch before committing and passes its URI on-chain", async () => {
    const order: string[] = [];
    const store = new MemoryBatchStore();
    const put = store.put.bind(store);
    store.put = async (r) => { order.push("store"); return put(r); };
    const committer: BatchCommitter = {
      commitBatch: async (p) => { order.push(`commit:${p.contentURI}`); return { txHash: "0x1", batchIndex: 0 }; },
    };
    const buffer = new BatchBuffer({ committer, agentAddress: AGENT, store });
    const { actionRef } = await buffer.add(preimage(0), { prompt_hash: "sha256:abc" });
    await buffer.flush();

    expect(order).toEqual(["store", `commit:memory://${actionRef}`]);
    const record = (await store.get(actionRef))!;
    expect(record).toMatchObject({
      schema: "agentaudit-evidence-v1",
      merkle_root: actionRef,
      agent_address: AGENT,
      leaf_hash: "sha256(jcs(preimage))",
      node_hash: "keccak256(sorted_pair)",
      odd_node: "promote",
    });
    expect(record.entries).toEqual([{ action_ref: actionRef, preimage: preimage(0), record: { prompt_hash: "sha256:abc" } }]);
  });

  it("validates its configuration", () => {
    const committer = makeCommitter();
    expect(() => new BatchBuffer({ committer, agentAddress: "not-an-address" })).toThrow();
    expect(() => new BatchBuffer({ committer, agentAddress: AGENT, maxEntries: 0 })).toThrow("maxEntries");
    expect(() => new BatchBuffer({ committer, agentAddress: AGENT, maxAgeSeconds: 0 })).toThrow("maxAgeSeconds");
    expect(() => new BatchBuffer({ committer, agentAddress: AGENT, complianceScore: 101 })).toThrow("complianceScore");
  });
});

// ─── FileBatchStore ──────────────────────────────────────────────────────────

describe("FileBatchStore", () => {
  it("writes one JSON file per batch and reads it back", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentaudit-batches-"));
    try {
      const store = new FileBatchStore(dir);
      const buffer = new BatchBuffer({ committer: makeCommitter(), agentAddress: AGENT, store });
      const { actionRef } = await buffer.add(VECTORS[0].preimage);
      const result = (await buffer.flush())!;

      const file = path.join(dir, `${actionRef}.json`);
      expect(result.contentURI).toBe(`file://${file}`);
      const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
      expect(onDisk.entries[0].preimage).toEqual(VECTORS[0].preimage);
      expect(await store.get(actionRef)).toEqual(onDisk);
      expect(await store.get(ethers.ZeroHash)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
