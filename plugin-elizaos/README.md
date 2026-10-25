# AgentAudit plugin for ElizaOS

On-chain EU AI Act compliance logging for ElizaOS agents, built on
[`@agentauditai/sdk`](https://www.npmjs.com/package/@agentauditai/sdk).

Audit logs are **batch-anchored**: every logged action becomes one `action_ref`
(SHA-256 of a canonical preimage — see
[Evidence Schema v1](../docs/EVIDENCE_SCHEMA.md)), and the plugin anchors one
Merkle root per batch with AuditVault v2 `commitBatch` — one transaction per
batch instead of one per action. Batches flush after 50 entries, 60 seconds
after the first buffered entry, or on demand.

## Actions

| Action | What it does | EU AI Act |
|---|---|---|
| `REGISTER_AGENT` | Registers the agent in AgentRegistration (Mantle) | Art. 13, 26 |
| `LOG_AUDIT` | Buffers one action for batch anchoring; `flush: true` anchors now | Art. 12, 19, 50 |
| `LOG_AUDIT_BATCH` | Buffers several actions and anchors them in one `commitBatch` | Art. 12, 19 |
| `REPORT_INCIDENT` | Registers an incident in IncidentRegistry v2 (see below) | Art. 73 |
| `RECORD_METRIC` | Records a post-market monitoring metric | Art. 72 |
| `AUDIT_STATUS` | Network, batch-anchoring availability, batches on-chain, pending entries | — |

With `AUDIT_AUTO_LOG=true`, the middleware buffers an `AUTO_LOG` entry for every
message. It never blocks the agent and swallows failures.

`plugin.batch` exposes `flush()`, `close()` (call on shutdown), `pending()` and
`getInclusionProof(actionRef)` → `{ leaf, proof[], root, batchId, batchIndex, agentAddress, txHash }`,
which verifies on-chain with `AuditVault.verifyLog(agentAddress, batchIndex, leaf, proof)`.

### `REPORT_INCIDENT` options

Uses the SDK's `reportIncident()` against IncidentRegistry v2. Every network has a
default registry ([addresses](../sdk/README.md#incidentregistry-art-73)).

| Option | Values | Default |
|---|---|---|
| `severity` | `0`–`3` or `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` (any case) | `MEDIUM` |
| `harmType` | `0`–`4` or `DEATH` \| `SERIOUS_HEALTH_HARM` \| `SIGNIFICANT_PROPERTY_DAMAGE` \| `FUNDAMENTAL_RIGHTS_VIOLATION` \| `OTHER` | `OTHER` |
| `affectedPersons` | integer ≥ 0 | `0` |
| `description` | text, **stored in plain text on-chain** | the message text |
| `evidenceHash` | hash or IPFS/Arweave URI | `keccak256(description)` |
| `occurredAt` | unix seconds, not in the future | latest block time |
| `agentId` | bytes32 hex (used as-is) or any id (keccak256-hashed) | `AUDIT_AGENT_ID` |

An invalid `severity` / `harmType` returns `false` without sending anything. The
callback carries `incidentId`, `txHash`, `severity` and `harmType`. If the
configured address is not an IncidentRegistry v2, the action returns `false` with
`IncidentRegistry v2 is not available on <network>: …`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `AUDIT_PRIVATE_KEY` | yes | Agent wallet key (signs all transactions; batches are committed under its address) |
| `AUDIT_AGENT_ID` | for logging | Numeric agent id from AgentRegistration (goes into each preimage) |
| `AUDIT_NETWORK` | no | `mantle` (default) \| `base` \| `arbitrum` \| `optimism` \| `polygon` |
| `AUDIT_AUTO_LOG` | no | `true` = auto-log every message |
| `AUDIT_INCIDENT_REGISTRY` | no | IncidentRegistry v2 override (default: the SDK's address for `AUDIT_NETWORK`) |
| `AUDIT_MONITOR_ADDRESS` | for `RECORD_METRIC` | PostMarketMonitor address |
| `AUDIT_REGISTRATION_ADDRESS` | no | AgentRegistration override (Mantle) |
| `AUDIT_BATCH_DIR` | no | Where batch JSON files are written (default `./agentaudit-batches`) |
| `AUDIT_RPC_URL` | no | Override the network's RPC URL |
| `AUDIT_VAULT_ADDRESS` | no | AuditVault v2 address — enables batch anchoring on any network |

Never commit private keys — keep them in a gitignored `.env`.

## Networks — batch anchoring support

> **Set `AUDIT_NETWORK=base` for batch logging.** The default network stays
> `mantle` because Base has no PostMarketMonitor deployment yet (so
> `RECORD_METRIC` could not follow the default there), but Mantle's AuditVault
> is v1 and cannot batch-anchor.

Batch anchoring needs AuditVault v2. Default contracts today:

| Network | Batch anchoring by default |
|---|---|
| Base | ✅ Yes (AuditVault v2) |
| Arbitrum One | ❌ No — default contract is not AuditVault v2 |
| Optimism | ❌ No — default contract is not AuditVault v2 |
| Polygon | ❌ No — default contract is not AuditVault v2 |
| Mantle (plugin default) | ❌ No — AuditVault v1 |

On a ❌ network, `LOG_AUDIT` / `LOG_AUDIT_BATCH` return `false` with
`Batch anchoring is not available on <network>: …`, and `AUDIT_STATUS` reports
it. Set `AUDIT_NETWORK=base`, or `AUDIT_VAULT_ADDRESS` to an AuditVault v2
deployment. `REGISTER_AGENT`, `REPORT_INCIDENT` and `RECORD_METRIC` are not
affected. Details: [`sdk/README.md`](../sdk/README.md#supported-networks).

## Batch files hold hashes only

Each batch is stored as one JSON file in `AUDIT_BATCH_DIR` and its location is
anchored on-chain as `contentURI`. A file contains `action_ref`s, preimages
(action type, agent id, a scope made of hashes, timestamp) and records of
`{ plugin, action_type, risk_level, payload_hash }` — **never message text**.
`agentaudit-batches/` is gitignored. Keep the files: auditors need them to
recompute `action_ref`s and inclusion proofs.

Verifiers must check the batch `submitter` and recompute `action_ref` from the
preimage — see [docs/THREAT_MODEL.md](../docs/THREAT_MODEL.md) ("Known issues —
AuditVault v2").
