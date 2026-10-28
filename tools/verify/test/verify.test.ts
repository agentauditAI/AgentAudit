// verifyBundle + CLI against an in-memory AuditVault v2 (FakeVault): the demo
// bundle as committed, plus tampered preimage, wrong root, wrong txHash and
// swapped proofs. The real contract is exercised in verify.anvil.test.ts.

import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { ethers } from "ethers";
import { main } from "../src/cli";
import { merkleProof, verifyProof } from "../src/evidence";
import { AUDIT_VAULT_V2_ABI, KNOWN_CHAINS, verifyBundle, type ChainReader, type ReceiptLike } from "../src/verify";

const ROOT = path.join(__dirname, "../../..");
const DEMO_PATH = path.join(ROOT, "docs/demo/first-anchor-bundle.json");
const MNEMOPAY_PATH = path.join(ROOT, "fixtures/mnemopay-anchor/v1/bundle.json");
const DEMO = JSON.parse(readFileSync(DEMO_PATH, "utf8"));

const BASE_VAULT = KNOWN_CHAINS.base.vault!;
const AGENT = "0x1111111111111111111111111111111111111111";
const SUBMITTER = "0x2222222222222222222222222222222222222222";
const OTHER_TX = "0x" + "ab".repeat(32);
const iface = new ethers.Interface(AUDIT_VAULT_V2_ABI);

// ─── Fake vault ───────────────────────────────────────────────────────────────

/** One committed batch per tx; verifyLog mirrors AuditVault._verifyMerkle */
class FakeVault implements ChainReader {
  chain = 8453n;
  calls: { leaf: string; proof: string[] }[] = [];
  private receipts = new Map<string, ReceiptLike>();
  private roots: string[] = [];

  constructor(readonly vault = BASE_VAULT) {}

  commit(txHash: string, root: string, eventCount: number): void {
    const batchIndex = this.roots.length;
    this.roots.push(root);
    const { topics, data } = iface.encodeEventLog("LogBatchCommitted", [
      AGENT,
      batchIndex,
      root,
      "agentaudit-demo:x:2026-10-28T12:00:00.000Z",
      eventCount,
      0,
      1793188800,
    ]);
    this.receipts.set(txHash.toLowerCase(), { status: 1, blockNumber: 100 + batchIndex, logs: [{ address: this.vault, topics, data }] });
  }

  setReceipt(txHash: string, r: ReceiptLike): void {
    this.receipts.set(txHash.toLowerCase(), r);
  }

  async chainId() {
    return this.chain;
  }
  async getCode(address: string) {
    return address.toLowerCase() === this.vault.toLowerCase() ? "0x6080" : "0x";
  }
  async getReceipt(txHash: string) {
    return this.receipts.get(txHash.toLowerCase()) ?? null;
  }
  async getBatchSubmitter() {
    return SUBMITTER;
  }
  async verifyLog(_v: string, _a: string, batchIndex: bigint, leaf: string, proof: string[]) {
    this.calls.push({ leaf, proof });
    const root = this.roots[Number(batchIndex)];
    if (root === undefined) throw new Error("execution reverted: AuditVault: batch not found");
    return verifyProof(leaf, proof, root);
  }
}

function demoVault(): FakeVault {
  const v = new FakeVault();
  v.commit(DEMO.meta.anchor.txHash, DEMO.merkle_root, DEMO.entries.length);
  return v;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const byName = (r: { checks: { name: string; status: string; detail: string }[] }, name: string) =>
  r.checks.find((c) => c.name === name);
const failed = (r: { checks: { name: string; status: string }[] }) =>
  r.checks.filter((c) => c.status === "FAIL").map((c) => c.name);

// ─── verifyBundle ─────────────────────────────────────────────────────────────

describe("verifyBundle — demo bundle as committed", () => {
  it("passes every check with derived proofs and recomputed leaves", async () => {
    const vault = demoVault();
    const r = await verifyBundle(DEMO, { reader: vault });
    expect(failed(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual([
      "bundle.schema",
      "entry[0].action_ref",
      "entry[1].action_ref",
      "entry[2].action_ref",
      "merkle_root",
      "anchor.reference",
      "rpc.chain",
      "anchor.vault",
      "anchor.receipt",
      "anchor.event",
      "anchor.event_count",
      "entry[0].verifyLog",
      "entry[1].verifyLog",
      "entry[2].verifyLog",
    ]);
    expect(vault.calls.map((c) => c.leaf)).toEqual(DEMO.entries.map((e: { action_ref: string }) => e.action_ref));
    expect(r.info.some((l) => l.includes(`submitter ${SUBMITTER} — not checked`))).toBe(true);
  });

  it("checks the submitter when pinned (THREAT_MODEL KI-1)", async () => {
    const good = await verifyBundle(DEMO, { reader: demoVault(), submitter: SUBMITTER.toLowerCase() });
    expect(byName(good, "anchor.submitter")?.status).toBe("PASS");
    const bad = await verifyBundle(DEMO, { reader: demoVault(), submitter: AGENT });
    expect(failed(bad)).toEqual(["anchor.submitter"]);
    expect(bad.ok).toBe(false);
  });
});

describe("verifyBundle — tampering", () => {
  it("tampered preimage: action_ref, merkle_root and that entry's verifyLog fail", async () => {
    const b = clone(DEMO);
    b.entries[1].preimage.scope = b.entries[1].preimage.scope.replace("fx-rates", "fx-ratez");
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(["entry[1].action_ref", "merkle_root", "entry[1].verifyLog"]);
    expect(byName(r, "entry[1].action_ref")?.detail).toContain(`bundle says ${DEMO.entries[1].action_ref}`);
    // Intact entries still prove inclusion via siblings from the presented action_refs
    expect(byName(r, "entry[0].verifyLog")?.detail).toContain("true (proof from bundle action_refs");
  });

  it("tampered action_ref with intact preimage: the presented leaf is not trusted (KI-2)", async () => {
    const b = clone(DEMO);
    b.entries[0].action_ref = "0x" + "00".repeat(32);
    const vault = demoVault();
    const r = await verifyBundle(b, { reader: vault });
    expect(failed(r)).toEqual(["entry[0].action_ref"]);
    expect(vault.calls[0].leaf).toBe(DEMO.entries[0].action_ref);
  });

  it("non-schema preimage field is rejected", async () => {
    const b = clone(DEMO);
    b.entries[0].preimage.verdict = "ALLOW";
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(byName(r, "entry[0].action_ref")?.detail).toBe("preimage has non-schema field(s): verdict");
    expect(byName(r, "merkle_root")?.detail).toBe("cannot rebuild the tree: some preimages are invalid");
    expect(byName(r, "entry[0].verifyLog")?.detail).toBe("skipped: action_ref could not be recomputed");
    // The other entries still prove inclusion via siblings from the presented action_refs
    expect(failed(r)).toEqual(["entry[0].action_ref", "merkle_root", "entry[0].verifyLog"]);
    expect(byName(r, "entry[1].verifyLog")?.detail).toContain("true (proof from bundle action_refs");
  });

  it("wrong merkle_root: rebuild, rootCommitment and on-chain root all disagree", async () => {
    const b = clone(DEMO);
    b.merkle_root = "0x" + "11".repeat(32);
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(failed(r)).toEqual(["merkle_root", "anchor.reference", "anchor.event"]);
    expect(byName(r, "anchor.event")?.detail).toBe(`on-chain root ${DEMO.merkle_root} ≠ merkle_root 0x${"11".repeat(32)}`);
  });

  it("wrong merkle_root and rootCommitment together still fail against the chain", async () => {
    const b = clone(DEMO);
    b.merkle_root = "0x" + "11".repeat(32);
    b.meta.anchor.rootCommitment = "11".repeat(32);
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(failed(r)).toEqual(["merkle_root", "anchor.event"]);
  });

  it("wrong txHash (unknown transaction): receipt check fails", async () => {
    const b = clone(DEMO);
    b.meta.anchor.txHash = OTHER_TX;
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(failed(r)).toEqual(["anchor.receipt"]);
    expect(byName(r, "anchor.receipt")?.detail).toBe(`transaction ${OTHER_TX} not found (no receipt)`);
  });

  it("wrong txHash (another batch's tx): on-chain root mismatch", async () => {
    const vault = demoVault();
    vault.commit(OTHER_TX, "0x" + "22".repeat(32), 3);
    const b = clone(DEMO);
    b.meta.anchor.txHash = OTHER_TX;
    const r = await verifyBundle(b, { reader: vault });
    expect(failed(r)).toEqual(["anchor.event", "entry[0].verifyLog", "entry[1].verifyLog", "entry[2].verifyLog"]);
  });

  it("wrong txHash (tx without a vault event, or from another contract)", async () => {
    const vault = demoVault();
    const real = await vault.getReceipt(DEMO.meta.anchor.txHash);
    vault.setReceipt(OTHER_TX, { ...real!, logs: [{ ...real!.logs[0], address: AGENT }] });
    const b = clone(DEMO);
    b.meta.anchor.txHash = OTHER_TX;
    const r = await verifyBundle(b, { reader: vault });
    expect(byName(r, "anchor.event")?.detail).toBe(`transaction emitted no LogBatchCommitted from ${BASE_VAULT}`);
  });

  it("reverted transaction fails the receipt check", async () => {
    const vault = demoVault();
    vault.setReceipt(DEMO.meta.anchor.txHash, { status: 0, blockNumber: 7, logs: [] });
    const r = await verifyBundle(DEMO, { reader: vault });
    expect(byName(r, "anchor.receipt")?.detail).toBe("transaction reverted (status 0) in block 7");
  });

  it("swapped proofs: verifyLog fails for both entries", async () => {
    const b = clone(DEMO);
    const leaves = DEMO.entries.map((e: { action_ref: string }) => e.action_ref);
    b.entries.forEach((e: { proof?: string[] }, i: number) => (e.proof = merkleProof(leaves, i)));
    [b.entries[0].proof, b.entries[2].proof] = [b.entries[2].proof, b.entries[0].proof];
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(failed(r)).toEqual(["entry[0].verifyLog", "entry[2].verifyLog"]);
    expect(byName(r, "entry[0].verifyLog")?.detail).toContain("AuditVault.verifyLog returned false (bundle proof");
    expect(byName(r, "entry[1].verifyLog")?.detail).toContain("true (bundle proof");
  });

  it("malformed bundle proof is reported, not sent", async () => {
    const b = clone(DEMO);
    b.entries[0].proof = ["0x12"];
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(byName(r, "entry[0].verifyLog")?.detail).toBe("entry.proof is not an array of bytes32 hex strings");
  });

  it("event count mismatch fails", async () => {
    const vault = new FakeVault();
    vault.commit(DEMO.meta.anchor.txHash, DEMO.merkle_root, 1);
    const r = await verifyBundle(DEMO, { reader: vault });
    expect(failed(r)).toEqual(["anchor.event_count"]);
  });
});

describe("verifyBundle — anchor and RPC", () => {
  it("rejects the MnemoPay ChainBundle fixture as not Evidence Schema v1", async () => {
    const r = await verifyBundle(JSON.parse(readFileSync(MNEMOPAY_PATH, "utf8")), { reader: demoVault() });
    expect(r.ok).toBe(false);
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].detail).toContain('schema is undefined, expected "agentaudit-evidence-v1"');
    expect(r.checks[0].detail).toContain("entries is missing or empty");
  });

  it("non-object bundle", async () => {
    const r = await verifyBundle([], { reader: demoVault() });
    expect(r.checks).toEqual([{ name: "bundle.schema", status: "FAIL", detail: "bundle is not a JSON object" }]);
  });

  it("missing meta.anchor", async () => {
    const b = clone(DEMO);
    delete b.meta.anchor;
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(failed(r)).toEqual(["anchor.reference"]);
  });

  it("unknown chain needs --vault", async () => {
    const b = clone(DEMO);
    b.meta.anchor.chain = "somechain";
    const r = await verifyBundle(b, { reader: demoVault() });
    expect(byName(r, "anchor.vault")?.detail).toBe('no known AuditVault v2 for chain "somechain"; pass --vault');
    const withVault = await verifyBundle(b, { reader: demoVault(), vault: BASE_VAULT });
    expect(withVault.ok).toBe(true);
    expect(byName(withVault, "rpc.chain")?.detail).toContain("not in the known list");
  });

  it("RPC on the wrong chain fails rpc.chain", async () => {
    const vault = demoVault();
    vault.chain = 1n;
    const r = await verifyBundle(DEMO, { reader: vault });
    expect(failed(r)).toEqual(["rpc.chain"]);
  });

  it("--vault without code fails anchor.vault", async () => {
    const r = await verifyBundle(DEMO, { reader: demoVault(), vault: AGENT });
    expect(byName(r, "anchor.vault")?.detail).toBe(`no contract code at ${AGENT}`);
  });

  it("RPC errors become FAILs", async () => {
    const vault = demoVault();
    vault.chainId = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const r = await verifyBundle(DEMO, { reader: vault });
    expect(byName(r, "rpc.chain")?.detail).toBe("RPC error: connect ECONNREFUSED");
    expect(r.ok).toBe(false);
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────────

describe("agentaudit-verify CLI", () => {
  const run = async (argv: string[], reader: ChainReader = demoVault()) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), makeReader: () => reader });
    return { code, out, err };
  };

  it("exit 0 and PASS lines for the demo bundle", async () => {
    const { code, out } = await run([DEMO_PATH, "--rpc", "http://fake"]);
    expect(code).toBe(0);
    expect(out.filter((l) => l.startsWith("PASS  entry["))).toHaveLength(6);
    expect(out[out.length - 1]).toBe("RESULT  PASS  14/14 checks passed");
  });

  it("exit 1 with the failing reason for a tampered bundle", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aa-verify-"));
    const b = clone(DEMO);
    b.entries[2].preimage.timestamp_ms += 1;
    const file = path.join(dir, "bundle.json");
    writeFileSync(file, JSON.stringify(b));
    const { code, out } = await run([file, "--rpc", "http://fake"]);
    expect(code).toBe(1);
    expect(out.some((l) => /^FAIL {2}entry\[2\]\.action_ref +sha256\(jcs\(preimage\)\) = 0x/.test(l))).toBe(true);
    expect(out[out.length - 1]).toBe("RESULT  FAIL  11/14 checks passed");
  });

  it("exit 2 on usage and I/O errors", async () => {
    expect((await run([])).code).toBe(2);
    expect((await run([DEMO_PATH])).err[0]).toBe("agentaudit-verify: --rpc <url> is required");
    expect((await run([DEMO_PATH, "--rpc"])).err[0]).toBe("agentaudit-verify: --rpc needs a value");
    expect((await run([DEMO_PATH, "--rpc", "x", "--bogus"])).err[0]).toBe("agentaudit-verify: unknown option --bogus");
    expect((await run([DEMO_PATH, DEMO_PATH, "--rpc", "x"])).err[0]).toBe("agentaudit-verify: expected exactly one <bundle.json>");
    const missing = await run(["/nonexistent/b.json", "--rpc", "x"]);
    expect(missing.code).toBe(2);
    expect(missing.err[0]).toContain("cannot read /nonexistent/b.json");
  });

  it("--help prints usage", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    expect(out[0]).toMatch(/^usage: agentaudit-verify/);
  });
});
