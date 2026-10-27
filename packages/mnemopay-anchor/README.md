# @agentauditai/mnemopay-anchor

An `OnChainAnchorSink` for [`@mnemopay/sdk`](https://github.com/mnemopay/mnemopay-sdk)
AuditChain bundles, backed by AgentAudit **AuditVault v2** `commitBatch`.

MnemoPay owns the structured log, the Merkle root and custody of the records
(EU AI Act Art. 12). This sink adds an external, append-only anchor for the root,
so a verifier can check that the root existed on-chain at a given block without
trusting the operator. The core is generic: it anchors any 32-byte Merkle root
and depends on MnemoPay only for the shape of its interface types.

> ## ⚠️ What an anchor does and does not prove
>
> **AuditVault v2 `commitBatch` does not authenticate the submitter.** Anyone can
> call it for any `agentId`. An anchor therefore proves **"this root existed at
> block T"**, not **who committed it**. `LogBatch.submitter` records `msg.sender`,
> but nothing on-chain ties that address to a producer, and the `agentId` this
> sink writes is simply the signer's own address. Signed, submitter-authenticated
> commits are planned for AuditVault **v3**. Until then, a verifier who needs
> to know the committer must check `LogBatch.submitter` against an address
> they already trust for that producer, as described in `docs/THREAT_MODEL.md`
> KI-1 ("`commitBatch` has no access control").
>
> **A transaction dropped from the mempool stays `pending` forever** in the
> process that broadcast it. The sink cannot tell "dropped" apart from "not yet
> mined", so `pollAnchor` keeps returning `pending` and you need your own
> deadline. A different process (for example after a restart) that doesn't find
> the transaction on-chain reports `failed` ("not found"). Treat a long `pending`
> as a signal to re-anchor, and don't wait on it indefinitely.

## Install

Not published yet. The package declares `@mnemopay/sdk >=1.14.3` as an optional
peer dependency: the anchor seam (`governance/anchor-sink`) exists only on the
unmerged MnemoPay branch `feat/onchain-anchor-sink`, and npm `latest` is 1.14.2.

## Usage

```ts
import { ethers } from "ethers";
import { AuditVaultAnchorSink } from "@agentauditai/mnemopay-anchor";
import { anchorChainBundle, pollAnchor, attachAnchorReference } from "@mnemopay/sdk/governance";

const sink = new AuditVaultAnchorSink({
  chain: "base",                                   // opaque, returned in AnchorReference.chain
  rpcUrl: process.env.ANCHOR_RPC_URL!,
  vaultAddress: process.env.ANCHOR_VAULT_ADDRESS!, // AuditVault v2 on that chain
  signer: new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY!),
  // namespace: "mnemopay",   // default
  // confirmations: 1,        // blocks before "anchored", default 1
  // statusTimeoutMs: 10000,  // status() RPC timeout, default 10 s
});

const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "acme/eu-prod" });
const status = await pollAnchor(sink, anchorId);
if (status.state === "anchored") {
  const { chain, txHash, rootCommitment } = status;
  const anchored = attachAnchorReference(bundle, { chain, txHash, rootCommitment });
  // verifyBundle(anchored) still passes: only meta.anchor is added
}
```

Nothing is hardcoded. Chain, RPC, vault address and signer all come from the caller.

## What goes on-chain

One `commitBatch(agentId, merkleRoot, contentURI, eventCount, complianceScore)` per anchor:

| Argument | Value |
|---|---|
| `agentId` | `await signer.getAddress()` |
| `merkleRoot` | `AnchorRequest.merkleRoot` as `bytes32` (bare or `0x` hex accepted; zero root rejected) |
| `contentURI` | `<namespace>:<sha256(producerId) hex>:<sealedAt>` |
| `eventCount` | `bundleMeta.event_count` if it is a positive integer, else `1` (one root) |
| `complianceScore` | `0` (unscored, same as `commitHighRiskEvent`) |

Raw events and bundle metadata never go on-chain.

### `producerId` is hashed

`producerId` is never written in plaintext. On-chain data is public, replicated
to every node and **cannot be erased**, so a plaintext organisation, customer or
person identifier could never be removed to honour a GDPR erasure request
(Art. 17) and would be exposed to anyone reading the chain. The sink writes
`sha256(UTF-8 producerId)` (lowercase hex) instead.

That hash is **pseudonymisation, not anonymisation** (GDPR Recital 26):
- **Guessable:** anyone who knows or guesses a `producerId` can recompute the hash and confirm it.
- **Linkable:** all anchors from one producer share the same hash, so they can be linked to each other.

Choose `producerId` values that aren't personal data in the first place.

## Status semantics

`anchorId` is the transaction hash. `status()` never throws:

| Situation | Result |
|---|---|
| Receipt found, `LogBatchCommitted` from the vault, enough confirmations | `anchored { chain, txHash, rootCommitment }` |
| Receipt found but fewer than `confirmations` blocks | `pending` |
| No receipt, transaction broadcast by this instance or visible in the mempool | `pending` (see the dropped-transaction caveat above) |
| No receipt, transaction unknown to the node | `failed` (unknown anchorId) |
| Malformed `anchorId` | `failed` (unknown anchorId) |
| Transaction reverted | `failed` |
| Transaction mined but emitted no `LogBatchCommitted` from `vaultAddress` | `failed` |
| RPC error or timeout (`statusTimeoutMs`) | `pending`, with the error in `sink.lastStatusError` |

`rootCommitment` is the root read back from the on-chain event, as bare lowercase
hex. For MnemoPay bundles that is byte-identical to `ChainBundle.merkle_root`.

`sink.getAnchorRecord(anchorId)` returns everything a verifier needs to check the
anchor against the chain itself: `vaultAddress`, `agentId`, `batchIndex`,
`blockNumber`, `contentURI`, `eventCount` and `complianceScore`. A verifier
should read `AuditVault.getBatch(agentId, batchIndex)` and compare
`merkleRoot` with the bundle's recomputed root.

Concurrent `anchor()` calls on one instance are serialised to avoid nonce
collisions. Don't share one signer across several instances or processes.

## Tests

From the repository root:

```bash
forge build                         # AuditVault v2 artifact for the anvil tests
npx jest packages/mnemopay-anchor   # unit, fixture, contract (anvil) suites
npx tsc -p packages/mnemopay-anchor/tsconfig.json --noEmit   # incl. type compatibility with MnemoPay
```

- `test/contract.anvil.test.ts` ports MnemoPay's `MockAnchorSink` contract tests
  and runs them against this sink on a real AuditVault v2.
- The anvil suites need Foundry. Set `AGENTAUDIT_SKIP_ANVIL=1` to skip them.
- MnemoPay sources used by the tests are vendored under `test/vendor/` (Apache-2.0,
  see `test/vendor/PROVENANCE.md`). The package itself doesn't ship them.

Shared fixture: [`fixtures/mnemopay-anchor/v1/`](../../fixtures/mnemopay-anchor/v1/README.md).

## License

MIT. Vendored test files under `test/vendor/` are Apache-2.0 (MnemoPay).
