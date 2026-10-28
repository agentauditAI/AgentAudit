// AgentAudit AI — first real anchor of a demo bundle on Base mainnet.
// Builds a small, fixed AgentAudit Evidence Schema v1 bundle (no personal data)
// and anchors its Merkle root via @agentauditai/mnemopay-anchor → AuditVault v2
// commitBatch. EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)
//
// Usage (from the repo root):
//   npx ts-node scripts/first-anchor.ts          # dry run: reads chain state, sends nothing
//   npx ts-node scripts/first-anchor.ts --send   # broadcasts ONE commitBatch, then polls
//
// Reads PRIVATE_KEY and BASE_RPC_URL from .env only (not from the process env).
// Neither value is ever printed; error messages are redacted before printing.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import * as path from "path";
import { parse as parseDotenv } from "dotenv";
import { ethers } from "ethers";
import {
  AUDIT_VAULT_V2_ABI,
  AuditVaultAnchorSink,
  anchorContentURI,
  hashProducerId,
  toBytes32Root,
} from "../packages/mnemopay-anchor/src/index";
import {
  EVIDENCE_SCHEMA,
  buildMerkleLevels,
  canonicalize,
  computeActionRef,
  dataReadScope,
  llmCallScope,
  merkleProof,
  sha256Hex,
  toolCallScope,
  verifyMerkleProof,
  type ActionPreimage,
} from "../sdk/src/batch";
import { NETWORKS } from "../sdk/src/index";

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT_DIR, ".env");
const OUT_FILE = path.join(ROOT_DIR, "docs/demo/first-anchor-bundle.json");

const CHAIN = "base";
const CHAIN_ID = 8453n;
const VAULT = "0xCeE831070aa9081422f30df5559c125aa47A75DB";
const PRODUCER_ID = "agentaudit-demo";
const NAMESPACE = "agentaudit-demo";
const CONFIRMATIONS = 2;
const BASESCAN_TX = "https://basescan.org/tx/";

// OP-stack GasPriceOracle predeploy (Base): L1 data fee for an L2 tx
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_PRICE_ORACLE_ABI = ["function getL1Fee(bytes _data) view returns (uint256)"];
const VAULT_READ_ABI = [
  "function getBatchCount(address agentId) view returns (uint256)",
  "function verifyLog(address agentId, uint256 batchIndex, bytes32 logHash, bytes32[] proof) view returns (bool)",
];

// ─── Demo bundle (fixed, deterministic: dry run and send anchor the same root) ─

const AGENT_ID = "agentaudit-demo-agent";
const SEALED_AT = "2026-10-28T12:00:00.000Z";
const T0 = Date.parse("2026-10-28T11:58:00.000Z");

interface DemoEntry {
  action_ref: string;
  preimage: ActionPreimage;
  record?: object;
}

function buildDemoBundle() {
  const llmRecord = {
    model: "demo-model",
    prompt_hash: "sha256:" + sha256Hex("Summarise today's weather and EUR/USD rate for the operator."),
    response_hash: "sha256:" + sha256Hex("Cool and dry; EUR/USD stable. No action needed."),
    risk_level: "LOW",
  };
  const actions: { preimage: ActionPreimage; record?: object }[] = [
    {
      preimage: {
        action_type: "tool_call",
        agent_id: AGENT_ID,
        scope: toolCallScope("weather_lookup", sha256Hex(canonicalize({ city: "Reykjavik", temp_c: 4, sky: "clear" }))),
        timestamp_ms: T0,
      },
    },
    {
      preimage: {
        action_type: "data_read",
        agent_id: AGENT_ID,
        scope: dataReadScope("/v1/fx-rates", "2026-10-28", sha256Hex(canonicalize({ pair: "EURUSD", rate: "1.0800" }))),
        timestamp_ms: T0 + 30_000,
      },
    },
    {
      preimage: {
        action_type: "LLM_DECISION",
        agent_id: AGENT_ID,
        scope: llmCallScope("demo-model", llmRecord),
        timestamp_ms: T0 + 60_000,
      },
      record: llmRecord,
    },
  ];
  const entries: DemoEntry[] = actions.map((a) => ({ action_ref: computeActionRef(a.preimage), ...a }));
  const levels = buildMerkleLevels(entries.map((e) => e.action_ref));
  return {
    bundle: {
      schema: EVIDENCE_SCHEMA,
      built_at: SEALED_AT,
      meta: {
        producer: PRODUCER_ID,
        purpose: "AgentAudit public demo bundle — synthetic actions, no personal data",
        event_count: entries.length,
      } as Record<string, unknown>,
      leaf_hash: "sha256(jcs(preimage))",
      node_hash: "keccak256(sorted_pair)",
      odd_node: "promote",
      merkle_root: levels[levels.length - 1][0],
      entries,
    },
    levels,
  };
}

// ─── Secrets (.env only, never printed) ───────────────────────────────────────

const secrets: string[] = [];

function redact(text: string): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}

function loadEnv(): { privateKey: string; rpcUrl: string } {
  if (!existsSync(ENV_FILE)) throw new Error(".env not found in the repo root");
  const env = parseDotenv(readFileSync(ENV_FILE));
  const rawKey = (env.PRIVATE_KEY ?? "").trim();
  const rpcUrl = (env.BASE_RPC_URL ?? "").trim();
  secrets.push(rawKey, rawKey.replace(/^0x/, ""), rpcUrl);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) throw new Error("PRIVATE_KEY in .env is missing or not a 32-byte hex key");
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error("BASE_RPC_URL in .env is missing or not an http(s) URL");
  return { privateKey: rawKey.startsWith("0x") ? rawKey : "0x" + rawKey, rpcUrl };
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const send = process.argv.includes("--send");
  if (NETWORKS.base.auditVault.toLowerCase() !== VAULT.toLowerCase()) {
    throw new Error(`VAULT ${VAULT} does not match the SDK's Base AuditVault v2 (${NETWORKS.base.auditVault})`);
  }

  const { privateKey, rpcUrl } = loadEnv();
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const wallet = new ethers.Wallet(privateKey, provider);
  const signer = wallet.address;

  try {
    const network = await withTimeout(provider.send("eth_chainId", []), 15_000, "eth_chainId");
    if (BigInt(network) !== CHAIN_ID) throw new Error(`BASE_RPC_URL is chain ${BigInt(network)}, expected Base (8453)`);
    if ((await provider.getCode(VAULT)) === "0x") throw new Error(`no contract code at ${VAULT} on Base`);

    const { bundle, levels } = buildDemoBundle();
    const root = toBytes32Root(bundle.merkle_root);
    const contentURI = anchorContentURI(NAMESPACE, PRODUCER_ID, SEALED_AT);
    const eventCount = bundle.entries.length;

    const vaultRead = new ethers.Contract(VAULT, VAULT_READ_ABI, provider);
    const batchCountBefore = (await vaultRead.getBatchCount(signer)) as bigint;

    // Cost estimate: L2 execution (gas × maxFeePerGas, an upper bound) + L1 data fee
    const vault = new ethers.Contract(VAULT, AUDIT_VAULT_V2_ABI, wallet);
    const gas = (await vault.commitBatch.estimateGas(signer, root, contentURI, eventCount, 0)) as bigint;
    const fees = await provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const populated = await wallet.populateTransaction(
      await vault.commitBatch.populateTransaction(signer, root, contentURI, eventCount, 0),
    );
    const unsigned = ethers.Transaction.from({ ...populated, from: undefined } as ethers.TransactionLike<string>);
    const oracle = new ethers.Contract(GAS_PRICE_ORACLE, GAS_PRICE_ORACLE_ABI, provider);
    const l1Fee = (await oracle.getL1Fee(unsigned.unsignedSerialized)) as bigint;
    const l2Max = gas * maxFeePerGas;
    const totalMax = l2Max + l1Fee;
    const balance = await provider.getBalance(signer);

    console.log(`\n── ${send ? "SEND" : "DRY RUN"} — anchor demo bundle on Base mainnet ──`);
    console.log(`signer             ${signer}`);
    console.log(`balance            ${ethers.formatEther(balance)} ETH`);
    console.log(`vault (v2)         ${VAULT}`);
    console.log(`batches by signer  ${batchCountBefore} (this anchor would be batchIndex ${batchCountBefore})`);
    console.log(`merkle_root        ${root}`);
    console.log(`contentURI         ${contentURI}`);
    console.log(`  producerId       "${PRODUCER_ID}" → sha256 ${hashProducerId(PRODUCER_ID)}`);
    console.log(`eventCount         ${eventCount}   complianceScore 0`);
    console.log(`gas estimate       ${gas} gas × max ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);
    console.log(`  L2 execution     ≤ ${ethers.formatEther(l2Max)} ETH`);
    console.log(`  L1 data fee      ≈ ${ethers.formatEther(l1Fee)} ETH`);
    console.log(`  total            ≤ ${ethers.formatEther(totalMax)} ETH`);
    if (balance < totalMax) throw new Error("balance is below the estimated maximum cost — not sending");

    if (!send) {
      console.log(`\nDry run only — nothing was sent. Re-run with --send to broadcast one commitBatch.`);
      return;
    }

    const sink = new AuditVaultAnchorSink({
      chain: CHAIN,
      rpcUrl,
      vaultAddress: VAULT,
      signer: wallet,
      namespace: NAMESPACE,
      confirmations: CONFIRMATIONS,
      statusTimeoutMs: 15_000,
    });
    try {
      const { anchorId } = await sink.anchor({
        producerId: PRODUCER_ID,
        merkleRoot: bundle.merkle_root,
        bundleMeta: bundle.meta,
        sealedAt: SEALED_AT,
      });
      console.log(`\nbroadcast          ${anchorId}`);
      console.log(`basescan           ${BASESCAN_TX}${anchorId}`);

      // Base produces a block every ~2 s; give up after ~5 min (status stays pending
      // forever if the tx is dropped — see the package README)
      let status = await sink.status(anchorId);
      for (let i = 0; status.state === "pending" && i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        status = await sink.status(anchorId);
      }
      if (status.state !== "anchored") {
        const why = status.state === "failed" ? status.reason : `still pending (${sink.lastStatusError ?? "not yet mined"})`;
        throw new Error(`anchor not confirmed: ${why}. Check ${BASESCAN_TX}${anchorId}`);
      }

      const record = await sink.getAnchorRecord(anchorId);
      if (!record) throw new Error("anchored but no on-chain record found");
      if ("0x" + record.rootCommitment !== root) throw new Error("on-chain root differs from the bundle root");

      // Every entry must verify on-chain against the committed batch
      for (let i = 0; i < bundle.entries.length; i++) {
        const leaf = bundle.entries[i].action_ref;
        const proof = merkleProof(levels, i);
        if (!verifyMerkleProof(leaf, proof, root)) throw new Error(`entry ${i}: off-chain proof failed`);
        if (!(await vaultRead.verifyLog(record.agentId, record.batchIndex, leaf, proof))) {
          throw new Error(`entry ${i}: AuditVault.verifyLog returned false`);
        }
      }

      const anchored = {
        ...bundle,
        meta: {
          ...bundle.meta,
          anchor: { chain: status.chain, txHash: status.txHash, rootCommitment: status.rootCommitment },
        },
      };
      mkdirSync(path.dirname(OUT_FILE), { recursive: true });
      writeFileSync(OUT_FILE, JSON.stringify(anchored, null, 2) + "\n");

      console.log(`\n✔ anchored          block ${record.blockNumber}, batchIndex ${record.batchIndex}, agentId ${record.agentId}`);
      console.log(`txHash             ${status.txHash}`);
      console.log(`basescan           ${BASESCAN_TX}${status.txHash}`);
      console.log(`verifyLog          ${bundle.entries.length}/${bundle.entries.length} entries verified on-chain`);
      console.log(`saved              ${path.relative(ROOT_DIR, OUT_FILE)}`);
    } finally {
      sink.destroy();
    }
  } finally {
    provider.destroy();
  }
}

main().catch((err) => {
  console.error(`\n✖ ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
});
