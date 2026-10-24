# AgentAudit Evidence Schema v1

This document defines how an off-chain agent action is reduced to a single
`bytes32` evidence reference (`action_ref`) and anchored on-chain through
`AuditVault` (EU AI Act Art. 12, 13, 19).

Reference test suite: `test/AuditVaultActionRef.t.sol`.

---

## 1. `action_ref`

```
action_ref = SHA-256( JCS(preimage) )
```

- **JCS** — JSON Canonicalization Scheme, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
  Keys sorted lexicographically by UTF-16 code units, no insignificant
  whitespace, canonical number and string serialization.
- **SHA-256** over the UTF-8 bytes of the canonical JSON. Result is 32 bytes,
  used directly as a `bytes32` leaf.
- Canonicalization identifier: `jcs-rfc8785-v1`.

### 1.1 Preimage fields

| Field | Type | Description |
|---|---|---|
| `action_type` | string | Action identifier, e.g. `send_email`, `transfer_funds` |
| `agent_id` | string | Off-chain agent identifier |
| `scope` | string | Target of the action, or a result commitment (see §2) |
| `timestamp_ms` | integer | Unix time in milliseconds at issuance |

All four fields are required. No other fields enter the preimage.

### 1.2 Example

A `tool_call` action whose `scope` is a result commitment (§2.1), where the
tool result is the UTF-8 bytes `example result`.

Preimage (already JCS-canonical):

```json
{"action_type":"tool_call","agent_id":"agentaudit-example-agent","scope":"tool_call:web_search:result_hash:97e2255a47d3fa064bc6f02b70898dbc96ff64bb840b8a2d56b36d9e98b2e681","timestamp_ms":1761264000000}
```

`action_ref`:

```
0x42de5ecdb20e72e6f038c44c911870aac6200bb67db331b253bc8b794d5ffdad
```

Verified in CI by `test_actionRef_sha256_schemaExample` in
`test/AuditVaultActionRef.t.sol`.

### 1.3 Envelope-only fields

These fields belong to the receipt envelope and **must not** appear in the
preimage, so the `action_ref` stays stable regardless of them:

- `verdict` (ALLOW / DENY) — a denied action anchors exactly like an allowed one
- `policy_version` — keep policy context in the off-chain payload behind `contentURI`
- revocation status / `revocation_check_at_ms` — evaluated after issuance

---

## 2. Scope result commitments

When the evidence must bind an action to its *result* (not just its intent),
`scope` carries a result commitment string. All hashes are lowercase hex
SHA-256 digests with no `0x` prefix.

### 2.1 Tool call

```
tool_call:<tool>:result_hash:<sha256>
```

| Segment | Meaning |
|---|---|
| `<tool>` | Tool name as invoked by the agent |
| `<sha256>` | SHA-256 of the tool's JCS-canonicalized result (or raw bytes for non-JSON results) |

Example: `tool_call:web_search:result_hash:3b4c…e1f0`

### 2.2 Data read

```
data_read:<endpoint>:<dataset_version>:<result_hash>
```

| Segment | Meaning |
|---|---|
| `<endpoint>` | Data source identifier (API route, table, or URI) |
| `<dataset_version>` | Version / snapshot identifier of the dataset at read time |
| `<result_hash>` | SHA-256 of the returned data |

Example: `data_read:/v1/prices:2026-10-01:9a7f…02bc`

Segments must not contain `:`; percent-encode it (`%3A`) if an endpoint or
version identifier needs one.

---

## 3. On-chain anchoring

1. Off-chain: compute `action_ref` for each action.
2. Off-chain: build a sorted-pair `keccak256` Merkle tree over the `action_ref` leaves.
3. On-chain: `AuditVault.commitBatch(agent, merkleRoot, contentURI, eventCount, complianceScore)`.
   A single high-risk action may be anchored alone with
   `commitHighRiskEvent(agent, action_ref, contentURI)` (leaf == root).
4. Verification: `AuditVault.verifyLog(agent, batchIdx, action_ref, proof)`.

Leaves are SHA-256, internal nodes are keccak256. `verifyLog` is agnostic to
the leaf algorithm; the off-chain payload behind `contentURI` must state the
schema version (`agentaudit-evidence-v1`) so auditors can re-derive proofs.

---

## 4. Known mapping gaps

| Gap | Off-chain resolution |
|---|---|
| `agent_id` is a string; `AuditVault` keys agents by `address` | Maintain a string ↔ address mapping in the agent registry |
| `timestamp_ms` (ms) vs `block.timestamp` (s) | The ms value lives only inside the preimage; reconcile via the payload behind `contentURI` |
| Hybrid hashing (SHA-256 leaves, keccak256 nodes) | Record the schema version in batch metadata |

Raw action content never goes on-chain — see `docs/payload-best-practices.md`.
