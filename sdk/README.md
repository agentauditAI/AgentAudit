# @agentauditai/sdk

On-chain EU AI Act compliance for AI agents — immutable audit logs, Know Your Agent (KYA) registration, incident reporting, and post-market monitoring across 5 EVM networks.

**Enforcement deadline: August 2, 2026.**

[![npm](https://img.shields.io/npm/v/@agentauditai/sdk)](https://www.npmjs.com/package/@agentauditai/sdk)
[![license](https://img.shields.io/npm/l/@agentauditai/sdk)](LICENSE)

---

## Installation

```bash
npm install @agentauditai/sdk
```

---

## Quick Start

### 1. Register an AI agent (Art. 13, 26 — KYA standard)

```ts
import { createAgentAudit } from "@agentauditai/sdk";

const audit = createAgentAudit("base"); // uses AUDIT_PRIVATE_KEY env var

const { agentId, txHash, network } = await audit.registerAgent({
  name: "my-customer-support-agent",
  complianceLevel: "high",
});

console.log(`Agent registered: ID ${agentId} on ${network}`);
console.log(`Tx: ${txHash}`);
```

### 2. Audit LLM decisions with batch anchoring (Art. 12, 19 — record-keeping)

The OpenAI, Anthropic and LangChain wrappers batch by default: each call becomes
one `action_ref` (SHA-256 of the JCS-canonicalized preimage — see
[Evidence Schema v1](https://github.com/agentauditAI/AgentAudit/blob/main/docs/EVIDENCE_SCHEMA.md)),
and the buffer anchors a single Merkle root per batch via AuditVault v2
`commitBatch` — one transaction per batch instead of one per call. Only hashes
are recorded; raw prompts and responses never leave your process.

**Batch files hold hashes only.** Each stored batch (`FileBatchStore` writes one
JSON file per batch) contains `action_ref`s, preimages (action type, agent id,
a scope made of hashes, timestamp) and the hashed audit record (`prompt_hash`,
`response_hash`, token counts, latency) — never prompt or response text. Keep
the files anyway: auditors need them to recompute `action_ref`s and proofs.

```ts
import { AuditedOpenAI } from "@agentauditai/sdk/openai";
import { FileBatchStore } from "@agentauditai/sdk/batch";

const store = new FileBatchStore("./audit-batches"); // one JSON file per batch → contentURI

const client = new AuditedOpenAI({
  agentAudit: { privateKey: process.env.AUDIT_PRIVATE_KEY!, network: "base" },
  agentId: 42,
  batch: {
    store,
    maxEntries: 50,      // flush after 50 calls…
    maxAgeSeconds: 60,   // …or 60 s after the first buffered call
  },
});

const res = await client.chat.completions.create({ model: "gpt-4o", messages });

// On shutdown, anchor whatever is still buffered
const flushed = await client.buffer!.close(); // FlushResult | null

// Prove an action was in an anchored batch. action_refs are listed in the
// stored batch file (entries[].action_ref, in leaf order).
if (flushed) {
  const batch = await store.get(flushed.batchId);
  const proof = client.buffer!.getInclusionProof(batch!.entries[0].action_ref);
  // → { leaf, proof[], root, batchId, batchIndex, agentAddress, txHash }
  // verify on-chain: new AgentAudit({...}).verifyLog(proof.agentAddress, proof.batchIndex, proof.leaf, proof.proof)
}
```

- `AuditedAnthropic` (`@agentauditai/sdk/anthropic`) and `AgentAuditCallbackHandler` /
  `withAudit()` (`@agentauditai/sdk/langchain`) take the same `mode` and `batch` options.
- Pass one `BatchBuffer` as `batch: { buffer }` to share it across several clients.
- `mode: "per_action"` restores the 1.0.x behaviour (one `logAction` call per request) —
  but see the known limitation below: it reverts on the deployed contracts.
- Batch anchoring works on **Base** by default; see
  [Supported Networks](#supported-networks) for the other chains.
- Batches are committed under `batch.agentAddress` (default: the signer's address).
- Verifiers: always recompute `action_ref` from the stored preimage and check the batch
  `submitter` — see the
  [threat model](https://github.com/agentauditAI/AgentAudit/blob/main/docs/THREAT_MODEL.md)
  ("Known issues — AuditVault v2").

### 3. Log a single action directly (legacy per-action API)

> **Known limitation (1.1.0):** `log()` / `logBatch()` encode
> `logAction(uint256,string,bytes32,uint8)`, which the deployed AuditVault v1/v2
> contracts do not implement, so these calls revert on-chain. Use batch anchoring
> (above) for audit logs until this is fixed.

```ts
import AgentAudit from "@agentauditai/sdk";

const audit = new AgentAudit({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "arbitrum",
});

const result = await audit.log({
  agentId: 42,
  actionType: "LLM_DECISION",
  payload: {
    prompt_hash: audit.hash("Summarise the customer complaint"),
    response_hash: audit.hash("Refund approved for order #8821"),
    model: "claude-sonnet-4-6",
  },
  riskLevel: "HIGH",
});

console.log(`Logged on-chain: ${result.explorerUrl}`);
```

### 4. Compliance report — review status and record score (Art. 72)

```ts
import AgentAudit from "@agentauditai/sdk";

const audit = new AgentAudit({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "base",
  postMarketMonitorAddress: process.env.MONITOR_ADDRESS,
});

const agentAddress = audit.getAddress();
const logCount = await audit.getLogCount(42);

const { due, overdueBySeconds } = await audit.isReviewDue(agentAddress);
console.log(`Total on-chain logs: ${logCount}`);
console.log(`Review due: ${due}${due ? ` (${Math.floor(overdueBySeconds / 86400)} days overdue)` : ""}`);

// Record periodic compliance review (score is 0–10000, e.g. 9500 = 95.00%)
const { txHash } = await audit.recordReview({
  agentAddress,
  complianceScore: 9500,
  notes: "Q2 2026 periodic review — no anomalies detected",
});

console.log(`Review recorded: ${txHash}`);
```

### 5. Report a serious incident (Art. 73)

Writes to **IncidentRegistry v2** (`contracts/v2/IncidentRegistry.sol`). Every
network has a default registry, so no address is needed.

```ts
import AgentAudit from "@agentauditai/sdk";

const audit = new AgentAudit({ privateKey: process.env.AGENT_PRIVATE_KEY!, network: "base" });

const { incidentId, txHash } = await audit.reportIncident({
  agentId: 42,                                  // or a bytes32 hex string
  severity: "HIGH",                             // LOW | MEDIUM | HIGH | CRITICAL
  harmType: "FUNDAMENTAL_RIGHTS_VIOLATION",     // optional, default "OTHER"
  affectedPersons: 12,                          // optional, default 0
  description: "Credit model denied applicants by postcode",
  evidenceHash: "ipfs://bafy...",               // optional, default keccak256(description)
  occurredAt: 1761300000,                       // optional, default latest block time
});

// Once the national market surveillance authority has been notified (Art. 73§2):
const { withinDeadline } = await audit.markReportedToAuthority(incidentId, {
  authority: "0x...",            // address (or identifier) of the notified authority
  authorityRef: "MSA-2026-0042", // case reference issued by the authority
});

const incident = await audit.getIncident(incidentId); // status, authorityRef, withinDeadline, ...
```

| Parameter | Type | Default | On-chain |
|---|---|---|---|
| `agentId` | `string \| number` | required | `bytes32`: a 0x-prefixed 32-byte hex value is used as-is, anything else is `keccak256(String(agentId))` |
| `severity` | `IncidentSeverity` | required | Sets the reporting deadline: CRITICAL 2 days, HIGH 10 days, MEDIUM/LOW 15 days |
| `harmType` | `"DEATH" \| "SERIOUS_HEALTH_HARM" \| "SIGNIFICANT_PROPERTY_DAMAGE" \| "FUNDAMENTAL_RIGHTS_VIOLATION" \| "OTHER"` | `"OTHER"` | Nature of harm, the Art. 73§1 qualifying condition |
| `affectedPersons` | `number \| bigint` (≥ 0) | `0` | Number of persons affected (Art. 73§3) |
| `description` | `string` | required | Stored **in plain text** on-chain, so leave out personal data |
| `evidenceHash` | `string` | `keccak256(description)` | Hash or IPFS/Arweave URI of the evidence |
| `occurredAt` | unix seconds | latest block timestamp | Must not be in the future (the registry reverts) |

`markReportedToAuthority` can only be called by the wallet that reported the
incident, or by the registry deployer. Other methods: `getAgentIncidents(agentId)`
and `isWithinDeadline(incidentId)`.

---

## EU AI Act Coverage

| Article | Obligation | SDK method |
|---------|-----------|------------|
| Art. 9 | Risk management system | `log()` with `riskLevel` |
| Art. 11 | Technical documentation | `registerAgent()` |
| Art. 12 | Record-keeping & audit logs | `BatchBuffer` + `commitBatch()`, LLM wrappers |
| Art. 13 | Transparency to users | `registerAgent()`, `getMyAgents()` |
| Art. 14 | Human oversight | `log()` with `actionType` tagging |
| Art. 19 | Conformity assessment logging | `BatchBuffer` + `commitBatch()`, `verifyLog()` |
| Art. 26 | Deployer obligations (KYA) | `registerAgent()`, `revokeAgent()` |
| Art. 72 | Post-market monitoring | `enrollMonitoring()`, `recordMetric()`, `recordReview()` |
| Art. 73 | Serious incident reporting | `reportIncident()`, `markReportedToAuthority()` |

---

## Supported Networks

Batch anchoring (the wrappers' default mode) needs **AuditVault v2**
(`commitBatch(address,bytes32,string,uint256,uint8)`). Status of the default
AuditVault address on each network, checked against deployed bytecode:

| Network | Chain ID | Default AuditVault | Contract | Batch anchoring today |
|---------|----------|--------------------|----------|-----------------------|
| Base Mainnet | 8453 | `0xCeE831070aa9081422f30df5559c125aa47A75DB` | AuditVault v2 (bytecode verified) | ✅ **Yes** |
| Arbitrum One | 42161 | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | not AuditVault v2 — no `commitBatch` | ❌ No |
| Optimism Mainnet | 10 | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | not AuditVault v2 — no `commitBatch` | ❌ No |
| Polygon Mainnet | 137 | `0x6fC00423Df95a7caf6fFFDD93169b5C01480de02` | not AuditVault v2 — no `commitBatch` | ❌ No |
| Mantle Mainnet | 5000 | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | AuditVault v1 | ❌ No |

On a ❌ network, creating a wrapper in batch mode throws immediately:
`Batch anchoring is not available on <network>: …`. To anchor there anyway,
pass `auditVaultAddress` pointing at an AuditVault v2 deployment on that chain.
Registration, incident (Art. 73) and monitoring (Art. 72) methods are not
affected by this table.

### IncidentRegistry (Art. 73)

Default IncidentRegistry v2 addresses, from `deployments/phase7-<network>.json`.
On every network the runtime bytecode matches `contracts/v2/IncidentRegistry.sol`
(solc 0.8.20, via-IR, 200 runs, `paris`):

| Network | Default IncidentRegistry |
|---------|--------------------------|
| Base, Arbitrum One, Polygon, Mantle | `0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F` |
| Optimism | `0x976b03a2417cf7926813605F427ED499fdF61e10` |

Pass `incidentRegistryAddress` to use another deployment. On its first incident
call, each `AgentAudit` instance checks once that the address has code
implementing the v2 functions. If it doesn't (no contract, or an older registry),
every incident method throws
`IncidentRegistry v2 is not available on <network>: <address> …` without sending
a transaction.

---

## Environment variables

| Variable | Used by |
|----------|---------|
| `AUDIT_PRIVATE_KEY` | `createAgentAudit()` — agent wallet key (`AGENT_AUDIT_PRIVATE_KEY`, the name shown in the 1.0.x README, is still accepted but deprecated) |
| `AUDIT_INCIDENT_REGISTRY` | `createAgentAudit()` — optional IncidentRegistry v2 override (Art. 73); default per network |
| `AUDIT_MONITOR_ADDRESS` | `createAgentAudit()` — PostMarketMonitor address (Art. 72) |

Never commit private keys — keep them in a gitignored `.env`.

---

## Links

- Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- npm: [npmjs.com/package/@agentauditai/sdk](https://www.npmjs.com/package/@agentauditai/sdk)

---

AgentAudit AI — a [RunLockAI](https://getagentaudit.xyz) product
