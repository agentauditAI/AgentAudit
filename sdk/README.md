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

const audit = createAgentAudit("base"); // uses AGENT_AUDIT_PRIVATE_KEY env var

const { agentId, txHash, network } = await audit.registerAgent({
  name: "my-customer-support-agent",
  complianceLevel: "high",
});

console.log(`Agent registered: ID ${agentId} on ${network}`);
console.log(`Tx: ${txHash}`);
```

### 2. Audit an agent action (Art. 12, 19 — record-keeping)

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

### 3. Compliance report — review status and record score (Art. 72)

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
| Art. 12 | Record-keeping & audit logs | `log()`, `logBatch()` |
| Art. 13 | Transparency to users | `registerAgent()`, `getMyAgents()` |
| Art. 14 | Human oversight | `log()` with `actionType` tagging |
| Art. 19 | Conformity assessment logging | `log()`, `logBatch()` |
| Art. 26 | Deployer obligations (KYA) | `registerAgent()`, `revokeAgent()` |
| Art. 72 | Post-market monitoring | `enrollMonitoring()`, `recordMetric()`, `recordReview()` |
| Art. 73 | Serious incident reporting | `reportIncident()`, `markReportedToAuthority()` |

---

## Supported Networks

| Network | Chain ID |
|---------|----------|
| Base Mainnet | 8453 |
| Arbitrum One | 42161 |
| Optimism Mainnet | 10 |
| Polygon Mainnet | 137 |
| Mantle Mainnet | 5000 |

---

## Links

- Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- npm: [npmjs.com/package/@agentauditai/sdk](https://www.npmjs.com/package/@agentauditai/sdk)

---

AgentAudit AI — a [RunLockAI](https://getagentaudit.xyz) product
