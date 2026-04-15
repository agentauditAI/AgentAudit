[README (5).md](https://github.com/user-attachments/files/26763878/README.5.md)
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

Every entry satisfies EU AI Act logging requirements (Articles 9, 13, 14, 15, 17, 72).

## Deployments

| Network | Contract Address | Explorer |
|---------|-----------------|---------|
| **Mantle Mainnet** ✅ | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | [View on Mantlescan](https://explorer.mantle.xyz/address/0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b) |
| Arbitrum Sepolia | `0xecb8a7b3676d6e2c24cf1110351de5192a2102ca` | [View on Arbiscan](https://sepolia.arbiscan.io) |

## Architecture

```
Your AI Agent
     │
     └── @agentaudit-xyz/sdk
              │
              ├── Off-chain logs → IPFS / Arweave (full payload)
              │
              └── AuditVault.sol  (Mantle Mainnet / any EVM)
                       │
                       └── Merkle root commitment (tamper-proof)
```

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

// Register your agent once
await audit.registerAgent('my-defi-agent', {
  model:   'gpt-4o',
  version: '1.0.0',
  owner:   '0xYourWallet',
})

// Log every action
const result = await audit.logAction({
  agentId:    'my-defi-agent',
  actionType: 'TRANSFER',
  payload:    { to: '0xabc...', amount: '500 USDC' },
})

console.log('On-chain:', result.txHash)
```

## Batch Logging (Gas Efficient)

```typescript
await audit.logActionBatch('my-defi-agent', [
  { actionType: 'PRICE_CHECK', payload: { pair: 'ETH/USDC' } },
  { actionType: 'SWAP',        payload: { from: 'ETH', to: 'USDC', amount: '1.2' } },
  { actionType: 'TRANSFER',    payload: { to: '0xabc...', amount: '3100 USDC' } },
])
```

## Repository Structure

```
AgentAudit/
├── contracts/
│   ├── AuditVault.sol      ← Core smart contract (v2)
│   └── AuditVault_v1.sol   ← Legacy reference
├── sdk/
│   ├── src/
│   │   └── index.ts        ← TypeScript SDK
│   └── package.json
├── plugin-elizaos/         ← ElizaOS plugin
├── index.html              ← Landing page (getagentaudit.xyz)
└── README.md
```

## ElizaOS Integration

AgentAudit is available as a native ElizaOS plugin.
```bash
cd plugin-elizaos
npm install
```

Add to your ElizaOS agent:
```javascript
const agentAuditPlugin = require('./plugin-elizaos');
// add to plugins array in your ElizaOS config
```

Every agent message is automatically logged to the blockchain as an immutable audit entry.

## Supported Networks

| Network | Status | Contract |
|---------|--------|---------|
| **Mantle Mainnet** | ✅ Live | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` |
| Arbitrum One | 🟡 Deploy with AuditVault.sol | — |
| Any EVM chain | ✅ Self-deploy | — |

## EU AI Act Compliance

AgentAudit's on-chain logs directly satisfy:

| Article | Requirement | How AgentAudit covers it |
|---------|-------------|--------------------------|
| Art. 9  | Risk management system | Risk scoring + high-risk event flagging |
| Art. 13 | Transparency & logging | Immutable action logs on IPFS + on-chain |
| Art. 14 | Human oversight | humanOversightFlag per event |
| Art. 15 | Accuracy & robustness | Tamper-proof Merkle commitment |
| Art. 17 | Quality management | Full audit history, cryptographically verifiable |
| Art. 72 | Incident reporting | Immediate commit on high-risk events |

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
**Twitter:** [@RunLockAI](https://twitter.com/RunLockAI)  
**Website:** [getagentaudit.xyz](https://getagentaudit.xyz)
