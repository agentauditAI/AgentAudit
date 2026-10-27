// MnemoPay OnChainAnchorSink contract tests, run against AuditVaultAnchorSink on
// a real AuditVault v2 (anvil). Ported from upstream tests/governance/anchor-sink.test.ts
// @ 3896f70 (see test/vendor/PROVENANCE.md): each case names the upstream test it
// retargets from MockAnchorSink. Upstream cases that only exercise SDK helpers
// with a hand-written sink ("stops polling as soon as the anchor resolves",
// "does not mutate the original bundle", "preserves unrelated meta keys") are
// sink-independent and are not repeated here.

import { ethers } from "ethers";
import { AuditVaultAnchorSink, anchorContentURI, type AnchorReference } from "../src/index";
import {
  ANCHOR_META_KEY,
  anchorChainBundle,
  attachAnchorReference,
  pollAnchor,
  type OnChainAnchorSink,
} from "./vendor/anchor-sink";
import { AuditChain, verifyBundle } from "./vendor/audit-chain";
import { KEY, SKIP_ANVIL, describeAnvil, startAnvil, type AnvilEnv } from "./anvil";

const PORT = 19545 + (process.pid % 1000);

if (SKIP_ANVIL) console.warn("[contract.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

function sealedBundle(events = 3) {
  const chain = new AuditChain();
  for (let i = 0; i < events; i++) chain.emit("llm.call", { i });
  return chain.toBundle({ producer: "test-suite" });
}

describeAnvil("OnChainAnchorSink contract × AuditVaultAnchorSink on anvil", () => {
  let env: AnvilEnv;
  const sinks: AuditVaultAnchorSink[] = [];
  let mine: () => Promise<void>;

  jest.setTimeout(60_000);

  function makeSink(overrides: Partial<ConstructorParameters<typeof AuditVaultAnchorSink>[0]> = {}) {
    const sink = new AuditVaultAnchorSink({
      chain: "anvil",
      rpcUrl: env.rpc,
      vaultAddress: env.vaultAddress,
      signer: new ethers.Wallet(KEY),
      ...overrides,
    });
    sinks.push(sink);
    return sink;
  }

  async function lastBatch(agent: string) {
    const count = Number(await env.vault.getBatchCount(agent));
    return { count, batch: count > 0 ? await env.vault.getBatch(agent, count - 1) : null };
  }

  beforeAll(async () => {
    env = await startAnvil(PORT);
    mine = async () => {
      await env.provider.send("evm_mine", []);
    };
  });

  afterAll(() => {
    sinks.forEach((s) => s.destroy());
    env?.stop();
  });

  // ─── anchorChainBundle ───────────────────────────────────────────────────────

  it("hands the sink the bundle's root, meta and seal time — committed on-chain with producerId hashed", async () => {
    const bundle = sealedBundle();
    const sink = makeSink();

    const handle = await anchorChainBundle(bundle, sink, { producerId: "mnemopay/test" });
    expect(handle.anchorId).toMatch(/^0x[0-9a-f]{64}$/);

    const status = await pollAnchor(sink, handle.anchorId, { attempts: 20, delayMs: 50 });
    expect(status.state).toBe("anchored");

    const record = await sink.getAnchorRecord(handle.anchorId);
    const agent = await new ethers.Wallet(KEY).getAddress();
    expect(record).toMatchObject({
      chain: "anvil",
      txHash: handle.anchorId,
      rootCommitment: bundle.merkle_root,
      vaultAddress: env.vaultAddress,
      agentId: agent,
      contentURI: anchorContentURI("mnemopay", "mnemopay/test", bundle.built_at),
      eventCount: 1,
      complianceScore: 0,
    });

    const { batch } = await lastBatch(agent);
    expect(batch.merkleRoot).toBe("0x" + bundle.merkle_root);
    expect(batch.contentURI).toBe(record!.contentURI);
    expect(batch.submitter).toBe(agent);
  });

  it("never puts raw events or the plaintext producerId on-chain", async () => {
    const bundle = sealedBundle();
    const sink = makeSink();
    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "acme-corp/eu-prod" });
    await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });

    const tx = await env.provider.getTransaction(anchorId);
    const receipt = await env.provider.getTransactionReceipt(anchorId);
    const onChain = [tx!.data, ...receipt!.logs.map((l) => l.data + l.topics.join(""))].join("").toLowerCase();
    for (const plaintext of ["llm.call", "acme-corp/eu-prod", "test-suite"]) {
      expect(onChain).not.toContain(ethers.hexlify(ethers.toUtf8Bytes(plaintext)).slice(2));
    }
  });

  it("refuses to anchor an empty root rather than attesting to nothing", async () => {
    const empty = new AuditChain().toBundle();
    expect(empty.merkle_root).toBe("");
    const sink = makeSink();
    const agent = await new ethers.Wallet(KEY).getAddress();
    const before = (await lastBatch(agent)).count;

    await expect(anchorChainBundle(empty, sink, { producerId: "p" })).rejects.toThrow(/empty merkle_root/);
    // The sink itself also refuses, for callers that bypass the helper
    await expect(sink.anchor({ producerId: "p", merkleRoot: "", bundleMeta: {}, sealedAt: empty.built_at })).rejects.toThrow(
      /32-byte hex string/,
    );
    expect((await lastBatch(agent)).count).toBe(before);
  });

  it("requires a producerId so anchors cannot collide across producers", async () => {
    const sink = makeSink();
    const bundle = sealedBundle();
    await expect(anchorChainBundle(bundle, sink, { producerId: "" })).rejects.toThrow(/producerId is required/);
    await expect(
      sink.anchor({ producerId: "", merkleRoot: bundle.merkle_root, bundleMeta: {}, sealedAt: bundle.built_at }),
    ).rejects.toThrow(/producerId is required/);
  });

  it("separates producers: same root, different producerId → different contentURI", async () => {
    const bundle = sealedBundle();
    const sink = makeSink();
    const a = await anchorChainBundle(bundle, sink, { producerId: "producer-a" });
    const b = await anchorChainBundle(bundle, sink, { producerId: "producer-b" });
    await pollAnchor(sink, b.anchorId, { attempts: 20, delayMs: 50 });
    const [ra, rb] = [await sink.getAnchorRecord(a.anchorId), await sink.getAnchorRecord(b.anchorId)];
    expect(ra!.rootCommitment).toBe(rb!.rootCommitment);
    expect(ra!.contentURI).not.toBe(rb!.contentURI);
    expect(rb!.batchIndex).toBe(ra!.batchIndex + 1);
  });

  it("uses the configured namespace", async () => {
    const bundle = sealedBundle();
    const sink = makeSink({ namespace: "acme" });
    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "p" });
    await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });
    expect((await sink.getAnchorRecord(anchorId))!.contentURI.startsWith("acme:")).toBe(true);
  });

  it("uses bundleMeta.event_count when present", async () => {
    const chain = new AuditChain();
    chain.emit("e", {});
    const bundle = chain.toBundle({ event_count: 5 });
    const sink = makeSink();
    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "p" });
    await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });
    expect((await sink.getAnchorRecord(anchorId))!.eventCount).toBe(5);
  });

  it("serialises concurrent anchor() calls (no nonce collisions)", async () => {
    const sink = makeSink();
    const handles = await Promise.all(
      [0, 1, 2, 3].map((i) => anchorChainBundle(sealedBundle(i + 1), sink, { producerId: `p${i}` })),
    );
    expect(new Set(handles.map((h) => h.anchorId)).size).toBe(4);
    for (const h of handles) {
      expect((await pollAnchor(sink, h.anchorId, { attempts: 20, delayMs: 50 })).state).toBe("anchored");
    }
  });

  // ─── attachAnchorReference ───────────────────────────────────────────────────

  describe("attachAnchorReference with a real reference", () => {
    let bundle: ReturnType<typeof sealedBundle>;
    let ref: AnchorReference;

    beforeAll(async () => {
      bundle = sealedBundle(5);
      const sink = makeSink();
      const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "p" });
      const status = await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });
      if (status.state !== "anchored") throw new Error(`expected anchored, got ${status.state}`);
      ref = { chain: status.chain, txHash: status.txHash, rootCommitment: status.rootCommitment };
    });

    it("does NOT invalidate the merkle root — the bundle still verifies", () => {
      expect(verifyBundle(bundle)).toEqual({ ok: true });
      const anchored = attachAnchorReference(bundle, ref);
      expect(anchored.merkle_root).toBe(bundle.merkle_root);
      expect(verifyBundle(anchored)).toEqual({ ok: true });
      expect(anchored.meta[ANCHOR_META_KEY]).toEqual(ref);
    });

    it("survives a JSON round-trip with the root intact", () => {
      const reparsed = JSON.parse(JSON.stringify(attachAnchorReference(bundle, ref)));
      expect(verifyBundle(reparsed)).toEqual({ ok: true });
      expect(reparsed.meta.anchor).toEqual(ref);
    });

    it("refuses to silently replace an existing anchor", () => {
      const anchored = attachAnchorReference(bundle, ref);
      expect(() => attachAnchorReference(anchored, { ...ref, txHash: "0xdifferent" })).toThrow(/already set/);
    });
  });

  // ─── pollAnchor / status ─────────────────────────────────────────────────────

  it("resolves pending → anchored and returns the reference", async () => {
    // confirmations: 2 keeps the anchor pending for one block; each "sleep" mines one
    const sink = makeSink({ confirmations: 2 });
    const bundle = sealedBundle();
    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "p" });
    expect(await sink.status(anchorId)).toEqual({ state: "pending" });

    const status = await pollAnchor(sink, anchorId, { attempts: 5, sleep: mine });

    expect(status.state).toBe("anchored");
    if (status.state === "anchored") {
      expect(status.rootCommitment).toBe(bundle.merkle_root);
      expect(status.chain).toBe("anvil");
      expect(status.txHash).toBe(anchorId);
    }
  });

  it("returns the terminal failure instead of throwing (tx did not reach AuditVault)", async () => {
    // vaultAddress is an EOA: the call succeeds but emits no LogBatchCommitted
    const sink = makeSink({ vaultAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    const { anchorId } = await anchorChainBundle(sealedBundle(), sink, { producerId: "p" });

    const status = await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });

    expect(status.state).toBe("failed");
    if (status.state === "failed") expect(status.reason).toMatch(/did not emit LogBatchCommitted/);
    expect(await sink.getAnchorRecord(anchorId)).toBeNull();
  });

  it("gives back 'pending' when attempts run out, distinguishable from failure", async () => {
    const sink = makeSink({ confirmations: 99 });
    const { anchorId } = await anchorChainBundle(sealedBundle(), sink, { producerId: "p" });

    const status = await pollAnchor(sink, anchorId, { attempts: 3, sleep: () => Promise.resolve() });

    expect(status).toEqual({ state: "pending" });
  });

  it("treats an unknown handle as failed, not as an exception", async () => {
    const sink = makeSink();
    for (const id of ["never-issued", "0x" + "ab".repeat(32)]) {
      const status = await pollAnchor(sink, id, { attempts: 1, sleep: () => Promise.resolve() });
      expect(status.state).toBe("failed");
    }
  });

  it("keeps a dropped broadcast pending in the sending process; a fresh process sees it as unknown", async () => {
    await env.provider.send("evm_setAutomine", [false]);
    try {
      const sink = makeSink();
      const { anchorId } = await anchorChainBundle(sealedBundle(), sink, { producerId: "p" });
      expect(await sink.status(anchorId)).toEqual({ state: "pending" });

      await env.provider.send("anvil_dropTransaction", [anchorId]);
      // Documented caveat: the sender cannot tell "dropped" from "not yet mined"
      expect(await sink.status(anchorId)).toEqual({ state: "pending" });

      const restarted = makeSink();
      const status = await restarted.status(anchorId);
      expect(status.state).toBe("failed");
      if (status.state === "failed") expect(status.reason).toMatch(/not found on anvil/);
    } finally {
      await env.provider.send("evm_setAutomine", [true]);
    }
  });

  it("resolves a handle issued by another process from chain state alone", async () => {
    const sender = makeSink();
    const bundle = sealedBundle();
    const { anchorId } = await anchorChainBundle(bundle, sender, { producerId: "p" });
    await pollAnchor(sender, anchorId, { attempts: 20, delayMs: 50 });

    const status = await makeSink().status(anchorId);
    expect(status).toEqual({ state: "anchored", chain: "anvil", txHash: anchorId, rootCommitment: bundle.merkle_root });
  });

  it("is injectable wherever MnemoPay expects its seam", () => {
    const seam: OnChainAnchorSink = makeSink();
    expect(typeof seam.anchor).toBe("function");
    expect(typeof seam.status).toBe("function");
  });

  // ─── End to end ──────────────────────────────────────────────────────────────

  it("seal → anchor → attach → verify, end to end on AuditVault v2", async () => {
    const chain = new AuditChain();
    chain.emit("mission.start", { charter: "c1" });
    chain.emit("payment.settled", { amount: 42 });
    chain.emit("mission.end", { ok: true });

    const sealed = chain.toBundle({ producer: "mnemopay/sdk" });
    const sink = makeSink({ confirmations: 2 });

    const { anchorId } = await anchorChainBundle(sealed, sink, { producerId: "mnemopay/sdk" });
    const status = await pollAnchor(sink, anchorId, { sleep: mine });
    expect(status.state).toBe("anchored");
    if (status.state !== "anchored") return;

    const final = attachAnchorReference(sealed, {
      chain: status.chain,
      txHash: status.txHash,
      rootCommitment: status.rootCommitment,
    });

    expect(verifyBundle(final)).toEqual({ ok: true });
    expect(final.events).toHaveLength(3);
    expect(final.meta.anchor.rootCommitment).toBe(sealed.merkle_root);

    // A verifier can check the anchor against the medium itself
    const record = await sink.getAnchorRecord(final.meta.anchor.txHash);
    const onChain = await env.vault.getBatch(record!.agentId, record!.batchIndex);
    expect(onChain.merkleRoot).toBe("0x" + final.merkle_root);
  });
});
