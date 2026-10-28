// Reproduces fixtures/mnemopay-anchor/v1 expected.json byte-for-byte on a fresh
// anvil: deploy at nonce 0, anchor at nonce 1 — including the environment-
// dependent fields (txHash, vaultAddress, blockNumber), which are only stable
// under exactly this setup.

import { readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { AuditVaultAnchorSink } from "../src/index";
import { anchorChainBundle, pollAnchor } from "./vendor/anchor-sink";
import type { ChainBundle } from "./vendor/audit-chain";
import { KEY, SKIP_ANVIL, describeAnvil, startAnvil, type AnvilEnv } from "./anvil";

const PORT = 20545 + (process.pid % 1000);
const DIR = path.join(__dirname, "../../../fixtures/mnemopay-anchor/v1");
const bundle: ChainBundle = JSON.parse(readFileSync(path.join(DIR, "bundle.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8"));

if (SKIP_ANVIL) console.warn("[fixture.anvil.test] AGENTAUDIT_SKIP_ANVIL=1 — integration test skipped");

describeAnvil("fixtures/mnemopay-anchor/v1 on a fresh anvil", () => {
  let env: AnvilEnv;
  let sink: AuditVaultAnchorSink;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    env = await startAnvil(PORT);
    sink = new AuditVaultAnchorSink({
      chain: expected.inputs.chain,
      rpcUrl: env.rpc,
      vaultAddress: env.vaultAddress,
      signer: new ethers.Wallet(KEY),
      namespace: expected.inputs.namespace,
    });
  });

  afterAll(() => {
    sink?.destroy();
    env?.stop();
  });

  it("reproduces the expected anchor reference, record and calldata", async () => {
    expect(env.vaultAddress).toBe(expected.anchor_record.vaultAddress);

    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: expected.inputs.producer_id });
    const status = await pollAnchor(sink, anchorId, { attempts: 20, delayMs: 50 });

    expect(status).toEqual({ state: "anchored", ...expected.anchor_reference });
    expect(await sink.getAnchorRecord(anchorId)).toEqual(expected.anchor_record);
    expect((await env.provider.getTransaction(anchorId))!.data).toBe(expected.derived.commit_batch_calldata);
  });
});
