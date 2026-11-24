# starclaw-chainbundle fixture v1

A fixed, signed StarClaw audit log and the MnemoPay AuditChain `ChainBundle` v1 that
`starclaw audit export` builds from it (`chain-bundle.json`). Shared so StarClaw,
MnemoPay and any anchoring sink (e.g. AgentAudit's) can check the same bytes.

| File | Contents |
|---|---|
| `audit.jsonl` | 5 signed StarClaw records (Ed25519, hash-chained): audit.open, goal.received, approval.decided, llm.usage, goal.completed |
| `audit.jsonl.head` | Signed head checkpoint (detects tail truncation) |
| `pubkey.txt` | The Ed25519 public key to pin (the private key is not kept) |
| `chain-bundle.json` | The ChainBundle v1 built from the log (no Article 12 link in meta) |
| `expected.json` | Pinned `merkle_root` and sha256 of `chain-bundle.json` |

## Pinned values

- `merkle_root`: `35a592434300017e903062fbff4488a2f3322479626289c37e78984fb54ddd04` (recomputed by `verifyBundle` from `@mnemopay/sdk/governance/audit-chain`)
- sha256(`chain-bundle.json`): `54f963b67973e6a81e07741d62e799008583e80d9e9f30dc09c6469f4824abfc`

## How events are mapped (deterministic)

| ChainEvent field | From the StarClaw record |
|---|---|
| `id` | UUID-shaped, derived from sha256("starclaw:" + record hash) |
| `sequence` | `seq` |
| `occurred_at` | `ts` (the original time, not the export time) |
| `kind` | `type` |
| `payload` | `{ data, starclaw: { seq, prev, hash, sig } }`, so each Ed25519 signature can be re-checked from the bundle |

`built_at` is the last record's `ts`. Leaves and the tree are the SDK's
(`sha256Hex(canonicalize(event))`, odd layers pad with the last leaf).
Bytes are LF only; `.gitattributes` keeps them verbatim.

Checked by `tests/chainBundle.test.ts`. Not yet run through AgentAudit's live sink.
