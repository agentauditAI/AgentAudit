// Anchors fixtures/starclaw-chainbundle/v1 through AuditVaultAnchorSink on a
// fresh anvil. txHash and blockNumber depend on the environment (deployer
// nonce, timestamps), so they are logged, not pinned.

import { readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { AUDIT_VAULT_V2_ABI, AuditVaultAnchorSink, anchorContentURI } from "../src/index";
import { anchorChainBundle, pollAnchor } from "./vendor/anchor-sink";
import type { ChainBundle } from "./vendor/audit-chain";
import { KEY, SKIP_ANVIL, describeAnvil, startAnvil, type AnvilEnv } from "./anvil";

const PORT = 21545 + (process.pid % 1000);
const DIR = path.join(__dirname, "../../../fixtures/starclaw-chainbundle/v1");
const bundle: ChainBundle = JSON.parse(readFileSync(path.join(DIR, "chain-bundle.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8"));

const CHAIN = "anvil";
const NAMESPACE = "mnemopay";
const PRODUCER_ID = "starclaw/fixture";

if (SKIP_ANVIL) console.warn("[fixture.starclaw.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

describeAnvil("fixtures/starclaw-chainbundle/v1 on a fresh anvil", () => {
  let env: AnvilEnv;
  let sink: AuditVaultAnchorSink;
  const signer = new ethers.Wallet(KEY);

  jest.setTimeout(60_000);

  beforeAll(async () => {
    env = await startAnvil(PORT);
    sink = new AuditVaultAnchorSink({
      chain: CHAIN,
      rpcUrl: env.rpc,
      vaultAddress: env.vaultAddress,
      signer,
      namespace: NAMESPACE,
    });
  });

  afterAll(() => {
    sink?.destroy();
    env?.stop();
  });

  it("anchors the StarClaw bundle root with the sink defaults", async () => {
    const contentURI = anchorContentURI(NAMESPACE, PRODUCER_ID, bundle.built_at);

    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: PRODUCER_ID });
    const status = await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });

    expect(status).toEqual({
      state: "anchored",
      chain: CHAIN,
      txHash: anchorId,
      rootCommitment: expected.merkle_root,
    });

    const record = await sink.getAnchorRecord(anchorId);
    expect(record).toMatchObject({
      chain: CHAIN,
      txHash: anchorId,
      rootCommitment: expected.merkle_root,
      vaultAddress: env.vaultAddress,
      agentId: signer.address,
      contentURI,
      eventCount: 1, // StarClaw meta has no event_count → sink default
      complianceScore: 0,
    });

    const calldata = new ethers.Interface(AUDIT_VAULT_V2_ABI).encodeFunctionData("commitBatch", [
      signer.address,
      "0x" + expected.merkle_root,
      contentURI,
      1,
      0,
    ]);
    expect((await env.provider.getTransaction(anchorId))!.data).toBe(calldata);

    console.log(
      `[fixture.starclaw.anvil.test] anchored txHash=${anchorId} blockNumber=${record!.blockNumber} vault=${env.vaultAddress}`,
    );
  });
});
