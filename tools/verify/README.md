# agentaudit-verify

Standalone verifier for AgentAudit Evidence Schema v1 bundles
(`docs/EVIDENCE_SCHEMA.md`) anchored with AuditVault v2 `commitBatch`.
It depends only on `ethers` — not on `sdk/` or `packages/` — so it re-derives
everything independently of the code that produced the bundle.

```
agentaudit-verify <bundle.json> --rpc <url> [--vault <address>] [--submitter <address>]
```

In this repo:

```bash
npx tsc -p tools/verify/tsconfig.build.json
node tools/verify/dist/cli.js docs/demo/first-anchor-bundle.json --rpc https://mainnet.base.org
```

## Checks

| Check | What it does |
|---|---|
| `bundle.schema` | `schema`, `leaf_hash`, `node_hash`, `odd_node` are the v1 values; `entries` non-empty; `merkle_root` is bytes32 |
| `entry[i].action_ref` | Preimage has exactly the four schema fields; `SHA-256(JCS(preimage))` (RFC 8785) equals the presented `action_ref` |
| `merkle_root` | Sorted-pair keccak256 tree over the recomputed `action_ref`s (odd node promoted) equals `merkle_root` |
| `anchor.reference` | `meta.anchor.txHash` is present; `meta.anchor.rootCommitment`, if present, equals `merkle_root` |
| `rpc.chain` | The RPC's chain id matches `meta.anchor.chain` (for `base`, `anvil`) |
| `anchor.vault` | Contract code exists at the vault (`--vault`, or the known AuditVault v2 for `base`) |
| `anchor.receipt` | The transaction exists and succeeded |
| `anchor.event` | A `LogBatchCommitted` from the vault carries `merkle_root` |
| `anchor.event_count` | Its `eventCount` equals the number of entries |
| `anchor.submitter` | Only with `--submitter`: `LogBatch.submitter` equals it |
| `entry[i].verifyLog` | `AuditVault.verifyLog(agentId, batchIndex, recomputed action_ref, proof)` returns `true` |

Exit code 0 only if every check passes; 1 if any fails; 2 on usage or I/O errors.

## Notes

- **Leaves are never trusted** (THREAT_MODEL KI-2): `verifyLog` is always called
  with the recomputed `action_ref`. The proof is `entry.proof` if the bundle has
  one; otherwise it is derived from the recomputed tree, falling back to siblings
  from the presented `action_ref`s so a single tampered preimage fails only its
  own entry.
- **Submitter** (THREAT_MODEL KI-1): `commitBatch` is permissionless, so a
  matching batch proves the root was on-chain at that block, not who committed
  it. Without `--submitter` the submitter is printed as `INFO`, not checked.
- The MnemoPay `ChainBundle` format (`fixtures/mnemopay-anchor/v1`) uses SHA-256
  inner nodes and is not Evidence Schema v1; it fails `bundle.schema`.
- JSON is parsed with `JSON.parse`, so duplicate keys are not detected (last one wins).

## Tests

`tools/verify/test/` — run by the root `npx jest`. `verify.anvil.test.ts` needs
Foundry (`anvil`) and `forge build` output, unless `AGENTAUDIT_SKIP_ANVIL=1`.
