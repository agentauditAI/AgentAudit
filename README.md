# AgentAudit

> **If your AI agent made a bad call, can you prove it?**
>
> Immutable on-chain audit logs for autonomous AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@agentaudit-xyz/sdk)](https://www.npmjs.com/package/@agentaudit-xyz/sdk)
[![Part of RunLockAI](https://img.shields.io/badge/RunLockAI-ecosystem-orange)](https://runlock.ai)

**Website:** [getagentaudit.xyz](https://getagentaudit.xyz)  
**Part of:** [RunLockAI](https://runlock.ai) — the runtime security ecosystem for AI agents

---

## The Problem

AI agents are executing high-value actions autonomously — transferring funds, voting on proposals, calling APIs, signing transactions. In Q1 2026 alone, $45M+ was lost to AI agent exploits.

When something goes wrong, there is no audit trail. No one can prove what the agent decided, when, or why.

AgentAudit solves this.

## What It Does

AgentAudit writes every agent action to the blockchain — immutable, timestamped, and permanently verifiable.

- **Who** authorized the action
- **What** was decided (action type + payload)
- **When** it happened (block timestamp)
- **Where** it was executed (block number + tx hash)

Every entry satisfies EU AI Act logging requirements (Articles 9, 12, 13, 19, 26, 72).

## Know Your Agent (KYA)

AgentAudit introduces the **KYA standard** — the on-chain identity and accountability layer for AI agents.

Inspired by KYC in finance, KYA defines what every deployed AI agent must declare before operating:

- Identity — who created and operates the agent
- Authorization — what actions it is permitted to take
- Spend limits — maximum token spend per transaction / per day
- Compliance level — EU AI Act risk classification (minimal / limited / high)
- Audit vault — address of the AuditVault contract logging this agent

See [docs/KYA_STANDARD.md](docs/KYA_STANDARD.md) for the full specification.

## Deployments

| Network | Contract | Address | Explorer |
|---------|----------|---------|----------|
| **Mantle Mainnet** ✅ | AuditVault v1 | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | [View](https://explorer.mantle.xyz/address/0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b) |
| **Mantle Mainnet** ✅ | AgentRegistration v2 | `0x68769980879414e8f264Ac15a87813E2ABaBaD6e` | [View](https://explorer.mantle.xyz/address/0x68769980879414e8f264Ac15a87813E2ABaBaD6e) |
| **Mantle Mainnet** ✅ | AgentAuditBatch v2 | `0xAF9ccA0C3D79900576557329F57824A0e277` | [View](https://explorer.mantle.xyz/address/0xAF9ccA0C3D79900576557329F57824A0e277) |
| Arbitrum One | All contracts | 🔄 Planned | — |

## Quick Start

```bash
npm install @agentaudit-xyz/sdk
```

```typescript
import { AgentAudit } from '@agentaudit-xyz/sdk'

const audit = new AgentAudit({
  rpcUrl:          'https://rpc.mantle.xyz',
  contractAddress: '0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b',
  privateKey:      process.env.AGENT_PRIVATE_KEY,
})

await audit.registerAgent('my-defi-agent', {
  model:   'gpt-4o',
  version: '1.0.0',
  owner:   '0xYourWallet',
})

const result = await audit.logAction({
  agentId:    'my-defi-agent',
  actionType: 'TRANSFER',
  payload:    { to: '0xabc...', amount: '500 USDC' },
})

console.log('On-chain:', result.txHash)
```

## Repository Structure

    AgentAudit/
    ├── contracts/
    │   ├── v1/
    │   │   └── AuditVault_v1.sol   ← Deployed on Mantle Mainnet
    │   └── v2/
    │       └── AuditVault.sol      ← EAS-based architecture (in development)
    ├── docs/
    │   ├── KYA_STANDARD.md
    │   ├── AUDIT_ARCHITECTURE.md
    │   ├── COMPLIANCE_MAPPING.md
    │   └── THREAT_MODEL.md
    ├── sdk/
    │   └── src/index.ts
    ├── plugin-elizaos/
    ├── index.html                  Landing page (getagentaudit.xyz)
    ├── CNAME
        └── README.md

## ElizaOS Integration

AgentAudit is available as a native ElizaOS plugin.

```bash
cd plugin-elizaos
npm install
```

Every agent message is automatically logged to the blockchain as an immutable audit entry.

## EU AI Act Compliance

AgentAudit's on-chain logs directly satisfy:

| Article | Requirement | How AgentAudit covers it |
|---------|-------------|--------------------------|
| Art. 9  | Risk management system | On-chain audit trail as risk evidence |
| Art. 12 | Record-keeping | AuditVault immutable logs |
| Art. 13 | Transparency | Public log queryability |
| Art. 19 | Logging requirements | Automatic per-action logging |
| Art. 26 | Deployer obligations | AgentRegistration + KYA fields |
| Art. 72 | Post-market monitoring | Continuous on-chain activity log |

**Enforcement deadline: August 2, 2026.**

## Part of RunLockAI

AgentAudit is one module in the [RunLockAI](https://runlock.ai) ecosystem:

| Project | Role |
|---------|------|
| [ShieldAI](https://getshieldai.xyz) | Runtime spend enforcement |
| **AgentAudit** | On-chain audit logging |
| AgentPay | Autonomous payment rails |
| StableSwitch | Stablecoin routing |

## License

MIT — free to use, fork, and build on.

---

**Contact:** agentaudit@proton.me  
**Twitter:** [@AgentAudit](https://twitter.com/AgentAudit)  
**Website:** [getagentaudit.xyz](https://getagentaudit.xyz)