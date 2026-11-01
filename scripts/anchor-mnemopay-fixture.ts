// AgentAudit AI — anchor the shared MnemoPay fixture bundle on Base mainnet.
// Anchors fixtures/mnemopay-anchor/v1/bundle.json with MnemoPay's anchorChainBundle()
// and our AuditVaultAnchorSink (@agentauditai/mnemopay-anchor) → AuditVault v2
// commitBatch. An anchor proves "this root existed at block T", not who committed it.
// EU AI Act: Art. 12 (record-keeping), Art. 19 (log retention)
//
// Usage (from the repo root):
//   npx ts-node scripts/anchor-mnemopay-fixture.ts --from 0x…   # dry run (default): no key, sends nothing
//   npx ts-node scripts/anchor-mnemopay-fixture.ts --send       # broadcasts ONE commitBatch, then polls
//
// Dry run: never reads .env. RPC = BASE_RPC_URL from the process env, else the
// public https://mainnet.base.org. The from-address comes from --from.
// Send: reads PRIVATE_KEY and BASE_RPC_URL from .env only (like first-anchor.ts).
// Neither value is ever printed; error messages are redacted before printing.

import { readFileSync, existsSync } from "fs";
import * as path from "path";
import { parse as parseDotenv } from "dotenv";
import { ethers } from "ethers";
import {
  AUDIT_VAULT_V2_ABI,
  AuditVaultAnchorSink,
  COMPLIANCE_SCORE,
  anchorContentURI,
  eventCountFromMeta,
  toBytes32Root,
} from "../packages/mnemopay-anchor/src/index";
import { anchorChainBundle } from "../packages/mnemopay-anchor/test/vendor/anchor-sink";
import { verifyBundle, type ChainBundle } from "../packages/mnemopay-anchor/test/vendor/audit-chain";
import { NETWORKS } from "../sdk/src/index";

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT_DIR, ".env");
const FIXTURE_DIR = path.join(ROOT_DIR, "fixtures/mnemopay-anchor/v1");

const CHAIN = "base";
const CHAIN_ID = 8453n;
const VAULT = "0xCeE831070aa9081422f30df5559c125aa47A75DB";
const PUBLIC_RPC = "https://mainnet.base.org";
const CONFIRMATIONS = 2;
const BASESCAN_TX = "https://basescan.org/tx/";
// expected.json's calldata was produced on anvil by account #0; only the agentId word differs elsewhere
const FIXTURE_AGENT_ID = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// OP-stack GasPriceOracle predeploy (Base): L1 data fee for an L2 tx
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_PRICE_ORACLE_ABI = ["function getL1Fee(bytes _data) view returns (uint256)"];
const VAULT_READ_ABI = ["function getBatchCount(address agentId) view returns (uint256)"];

// ─── Secrets (.env only, --send only, never printed) ──────────────────────────

const secrets: string[] = [];

function redact(text: string): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}

function loadSendEnv(): { privateKey: string; rpcUrl: string } {
  if (!existsSync(ENV_FILE)) throw new Error(".env not found in the repo root");
  const env = parseDotenv(readFileSync(ENV_FILE));
  const rawKey = (env.PRIVATE_KEY ?? "").trim();
  const rpcUrl = (env.BASE_RPC_URL ?? "").trim();
  secrets.push(rawKey, rawKey.replace(/^0x/, ""), rpcUrl);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) throw new Error("PRIVATE_KEY in .env is missing or not a 32-byte hex key");
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error("BASE_RPC_URL in .env is missing or not an http(s) URL");
  return { privateKey: rawKey.startsWith("0x") ? rawKey : "0x" + rawKey, rpcUrl };
}

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { send: boolean; from?: string } {
  let send = false;
  let dry = false;
  let from: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") send = true;
    else if (a === "--dry-run") dry = true;
    else if (a === "--from") from = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (send && dry) throw new Error("--send and --dry-run are mutually exclusive");
  if (from !== undefined && !ethers.isAddress(from)) throw new Error("--from must be a valid address");
  if (!send && !from) throw new Error("--dry-run needs --from <address> (no key is read in a dry run)");
  return { send, from: from && ethers.getAddress(from) };
}

// ─── Capture: run the real sink, intercept the transaction it would send ─────

const CAPTURED = Symbol("captured");

/** A keyless signer: records the commitBatch request the sink builds, then aborts the send */
class CapturingSigner extends ethers.VoidSigner {
  captured?: ethers.TransactionRequest;
  override async sendTransaction(tx: ethers.TransactionRequest): Promise<ethers.TransactionResponse> {
    this.captured = tx;
    throw CAPTURED;
  }
}

async function captureCommitBatch(
  bundle: ChainBundle,
  producerId: string,
  namespace: string,
  from: string,
  rpcUrl: string,
  provider: ethers.JsonRpcProvider,
): Promise<string> {
  const signer = new CapturingSigner(from, provider);
  const sink = new AuditVaultAnchorSink({ chain: CHAIN, rpcUrl, vaultAddress: VAULT, signer, namespace });
  try {
    await anchorChainBundle(bundle, sink, { producerId });
    throw new Error("sink sent a transaction through the capturing signer");
  } catch (err) {
    if (err !== CAPTURED) throw err;
  } finally {
    sink.destroy();
  }
  const tx = signer.captured!;
  if (String(tx.to).toLowerCase() !== VAULT.toLowerCase()) throw new Error(`sink targets ${tx.to}, expected ${VAULT}`);
  return ethers.hexlify(tx.data!);
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(`check failed: ${what}`);
  console.log(`  ✔ ${what}`);
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
  const { send, from: fromArg } = parseArgs(process.argv.slice(2));
  if (NETWORKS.base.auditVault.toLowerCase() !== VAULT.toLowerCase()) {
    throw new Error(`VAULT ${VAULT} does not match the SDK's Base AuditVault v2 (${NETWORKS.base.auditVault})`);
  }

  const bundle: ChainBundle = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "bundle.json"), "utf8"));
  const expected = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "expected.json"), "utf8"));
  const producerId: string = expected.inputs.producer_id;
  const namespace: string = expected.inputs.namespace;

  let rpcUrl: string;
  let wallet: ethers.Wallet | undefined;
  if (send) {
    const env = loadSendEnv();
    rpcUrl = env.rpcUrl;
    wallet = new ethers.Wallet(env.privateKey);
    if (fromArg && fromArg !== wallet.address) throw new Error(`--from ${fromArg} does not match the PRIVATE_KEY address`);
  } else {
    rpcUrl = (process.env.BASE_RPC_URL ?? "").trim() || PUBLIC_RPC;
    if (rpcUrl !== PUBLIC_RPC) secrets.push(rpcUrl);
  }
  const from = wallet ? wallet.address : fromArg!;
  const rpcLabel = rpcUrl === PUBLIC_RPC ? PUBLIC_RPC : "BASE_RPC_URL (redacted)";

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
  try {
    const chainId = BigInt(await withTimeout(provider.send("eth_chainId", []), 15_000, "eth_chainId"));
    if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected Base (8453)`);
    if ((await provider.getCode(VAULT)) === "0x") throw new Error(`no contract code at ${VAULT} on Base`);

    // 1. The bundle verifies and its root is the fixture's pinned root
    console.log(`\n── ${send ? "SEND" : "DRY RUN"} — anchor fixtures/mnemopay-anchor/v1 on Base mainnet ──`);
    console.log(`rpc                ${rpcLabel} (chainId ${chainId})`);
    console.log(`from               ${from}`);
    console.log(`vault (v2)         ${VAULT}\n`);
    console.log("bundle");
    check(verifyBundle(bundle).ok === true, "verifyBundle(bundle.json) ok (MnemoPay verifier, vendored)");
    check(bundle.merkle_root === expected.derived.merkle_root, `bundle merkle_root == expected.derived.merkle_root (${bundle.merkle_root})`);

    // 2. Calldata exactly as our sink builds it via anchorChainBundle()
    const data = await captureCommitBatch(bundle, producerId, namespace, from, rpcUrl, provider);
    const iface = new ethers.Interface(AUDIT_VAULT_V2_ABI);
    const decoded = iface.decodeFunctionData("commitBatch", data);
    const root = "0x" + expected.derived.merkle_root;
    const contentURI = anchorContentURI(namespace, producerId, bundle.built_at);
    console.log("\ncalldata (captured from AuditVaultAnchorSink.anchor via anchorChainBundle)");
    check(decoded.agentId === from, `agentId == from (${from})`);
    check(decoded.merkleRoot === root && root === toBytes32Root(bundle.merkle_root), `merkleRoot == 0x${expected.derived.merkle_root}`);
    check(decoded.contentURI === expected.derived.content_uri && decoded.contentURI === contentURI, `contentURI == "${contentURI}"`);
    check(Number(decoded.eventCount) === expected.derived.event_count && Number(decoded.eventCount) === eventCountFromMeta(bundle.meta), `eventCount == ${expected.derived.event_count}`);
    check(Number(decoded.complianceScore) === expected.derived.compliance_score && Number(decoded.complianceScore) === COMPLIANCE_SCORE, `complianceScore == ${expected.derived.compliance_score}`);
    const fixtureWord = ethers.zeroPadValue(FIXTURE_AGENT_ID, 32).slice(2).toLowerCase();
    const fromWord = ethers.zeroPadValue(from, 32).slice(2).toLowerCase();
    check(
      data.toLowerCase() === expected.derived.commit_batch_calldata.toLowerCase().replace(fixtureWord, fromWord),
      "calldata == expected.derived.commit_batch_calldata with only the agentId word replaced",
    );
    console.log(`\ncalldata           ${data}`);

    // 3. Simulation, gas and cost
    const vaultRead = new ethers.Contract(VAULT, VAULT_READ_ABI, provider);
    const batchIndex = (await vaultRead.getBatchCount(from)) as bigint;
    const callResult = await provider.call({ from, to: VAULT, data });
    const gas = await provider.estimateGas({ from, to: VAULT, data });
    const fees = await provider.getFeeData();
    const gasPrice = fees.gasPrice ?? 0n;
    const maxFeePerGas = fees.maxFeePerGas ?? gasPrice;
    const populated = await new ethers.VoidSigner(from, provider).populateTransaction({ to: VAULT, data, gasLimit: gas });
    const unsigned = ethers.Transaction.from({ ...populated, from: undefined } as ethers.TransactionLike<string>);
    const oracle = new ethers.Contract(GAS_PRICE_ORACLE, GAS_PRICE_ORACLE_ABI, provider);
    const l1Fee = (await oracle.getL1Fee(unsigned.unsignedSerialized)) as bigint;
    const l2Now = gas * gasPrice;
    const l2Max = gas * maxFeePerGas;
    const balance = await provider.getBalance(from);

    console.log(`\nsimulation`);
    console.log(`eth_call           ${callResult === "0x" ? "ok (no revert, empty return)" : callResult}`);
    console.log(`batchIndex         ${batchIndex} (getBatchCount(from) before this anchor)`);
    console.log(`estimateGas        ${gas}`);
    console.log(`gas price          ${ethers.formatUnits(gasPrice, "gwei")} gwei (maxFeePerGas ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei)`);
    console.log(`  L2 execution     ≈ ${ethers.formatEther(l2Now)} ETH at gas price, ≤ ${ethers.formatEther(l2Max)} ETH at max fee`);
    console.log(`  L1 data fee      ≈ ${ethers.formatEther(l1Fee)} ETH`);
    console.log(`  total            ≈ ${ethers.formatEther(l2Now + l1Fee)} ETH, ≤ ${ethers.formatEther(l2Max + l1Fee)} ETH`);
    console.log(`from balance       ${ethers.formatEther(balance)} ETH`);
    const enough = balance >= l2Max + l1Fee;
    if (!enough) console.log("  ⚠ balance is below the estimated maximum cost");

    if (!send) {
      console.log(`\nDry run only — nothing was sent, no key was read. Re-run with --send to broadcast one commitBatch.`);
      return;
    }
    if (!enough) throw new Error("balance is below the estimated maximum cost — not sending");

    // 4. Send through the same sink path, then wait for confirmations
    const sink = new AuditVaultAnchorSink({
      chain: CHAIN,
      rpcUrl,
      vaultAddress: VAULT,
      signer: wallet!,
      namespace,
      confirmations: CONFIRMATIONS,
      statusTimeoutMs: 15_000,
    });
    try {
      const { anchorId } = await anchorChainBundle(bundle, sink, { producerId });
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
      if (record.rootCommitment !== expected.derived.merkle_root) throw new Error("on-chain root differs from the bundle root");

      console.log(`\n✔ anchored          block ${record.blockNumber}, batchIndex ${record.batchIndex}, agentId ${record.agentId}`);
      console.log(`txHash             ${status.txHash}`);
      console.log(`rootCommitment     ${record.rootCommitment}`);
      console.log(`contentURI         ${record.contentURI}`);
      console.log(`basescan           ${BASESCAN_TX}${status.txHash}`);
      console.log(`\nThis root existed on Base at block ${record.blockNumber}.`);
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
