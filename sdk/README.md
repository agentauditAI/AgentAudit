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
- `mode: "per_action"` restores the 1.0.x behaviour (one `logAction` call per request).
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

| Network | Chain ID | AuditVault | Batch anchoring |
|---------|----------|------------|-----------------|
| Base Mainnet | 8453 | v2 `0xCeE8…75DB` | ✅ |
| Arbitrum One | 42161 | v2 `0x3057…450C` | ✅ |
| Optimism Mainnet | 10 | v2 `0x3057…450C` | ✅ |
| Polygon Mainnet | 137 | v2 `0x6fC0…de02` | ✅ |
| Mantle Mainnet | 5000 | v1 `0xD008…054b` | needs `auditVaultAddress` (v2) |

---

## Environment variables

| Variable | Used by |
|----------|---------|
| `AUDIT_PRIVATE_KEY` | `createAgentAudit()` — agent wallet key (`AGENT_AUDIT_PRIVATE_KEY`, the name shown in the 1.0.x README, is still accepted but deprecated) |
| `AUDIT_INCIDENT_REGISTRY` | `createAgentAudit()` — IncidentRegistry address (Art. 73) |
| `AUDIT_MONITOR_ADDRESS` | `createAgentAudit()` — PostMarketMonitor address (Art. 72) |

Never commit private keys — keep them in a gitignored `.env`.

---

## Links

- Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- npm: [npmjs.com/package/@agentauditai/sdk](https://www.npmjs.com/package/@agentauditai/sdk)

---

AgentAudit AI — a [RunLockAI](https://getagentaudit.xyz) product
