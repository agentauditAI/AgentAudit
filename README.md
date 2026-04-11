# AgentAudit 🔍

> **Immutable on-chain audit logs for AI agents. EU AI Act compliant.**

Every action your AI agent takes should be traceable, tamper-proof, and auditable. AgentAudit writes decision logs directly to the blockchain — so when something goes wrong, you know exactly what happened and when.

---

## The Problem

AI agents are making financial decisions, executing transactions, and interacting with external systems autonomously. But when something goes wrong — a bad trade, an unauthorized action, a compliance failure — there's often no reliable audit trail.

Logs stored off-chain can be modified. Logs stored in a database can be deleted. **Logs stored on-chain cannot.**

---

## What AgentAudit Does

- 📝 **Immutable logs** — every agent action written to the blockchain
- 🔐 **Tamper-proof** — on-chain storage cannot be altered retroactively
- 🇪🇺 **EU AI Act compliant** — satisfies Articles 12, 13, 14 logging requirements
- 🔗 **SDK ready** — drop-in TypeScript integration for any AI agent
- ⚡ **Lightweight** — minimal gas, maximum auditability

---

## Architecture

```
AI Agent Runtime
      │
      ▼
AgentAudit SDK (TypeScript)
      │
      ▼
AuditVault.sol (on-chain)
      │
      ▼
Immutable Log Entry {
  agentId,
  action,
  timestamp,
  txHash,
  callerAddress
}
```

---

## Smart Contract

**AuditVault.sol** — Deployed on Mantle Sepolia Testnet

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuditVault {
    struct LogEntry {
        address agent;
        string action;
        string metadata;
        uint256 timestamp;
    }

    LogEntry[] public logs;

    event ActionLogged(
        address indexed agent,
        string action,
        uint256 timestamp
    );

    function logAction(string calldata action, string calldata metadata) external {
        logs.push(LogEntry({
            agent: msg.sender,
            action: action,
            metadata: metadata,
            timestamp: block.timestamp
        }));

        emit ActionLogged(msg.sender, action, block.timestamp);
    }

    function getLog(uint256 index) external view returns (LogEntry memory) {
        return logs[index];
    }

    function totalLogs() external view returns (uint256) {
        return logs.length;
    }
}
```

---

## SDK — Quick Start

```bash
npm install @agentaudit/sdk
```

```typescript
import { AgentAudit } from '@agentaudit/sdk';

const audit = new AgentAudit({
  contractAddress: '0x...YOUR_DEPLOYED_ADDRESS',
  rpcUrl: 'https://rpc.sepolia.mantle.xyz',
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Log an agent action
await audit.log({
  action: 'TRANSFER_APPROVED',
  metadata: JSON.stringify({
    amount: '100 USDC',
    recipient: '0xRecipient...',
    reason: 'Invoice #4421',
  }),
});

// Retrieve logs
const total = await audit.totalLogs();
const entry = await audit.getLog(0);
console.log(entry);
```

---

## EU AI Act Compliance

AgentAudit directly addresses logging and transparency requirements:

| Article | Requirement | How AgentAudit Satisfies It |
|---------|------------|----------------------------|
| Art. 12 | Record-keeping for high-risk AI | Immutable on-chain logs per action |
| Art. 13 | Transparency to users | Every action timestamped and readable |
| Art. 14 | Human oversight capability | Full audit trail for review |
| Art. 17 | Quality management documentation | Structured metadata per log entry |

---

## Roadmap

- [x] AuditVault.sol smart contract
- [x] TypeScript SDK (v0.1.0-alpha)
- [x] Mantle Sepolia testnet deployment
- [ ] Dashboard UI
- [ ] IPFS metadata pinning
- [ ] Multi-chain support (Arbitrum, Base)
- [ ] Verifiable credential export (W3C VC)

---

## Related Projects

- **[ShieldAI](https://getshieldai.xyz)** — Runtime security and behavioral monitoring for AI agents
- **AgentPay** *(coming soon)* — Programmable payment vaults for AI agents

---
## Deployment

- **Contract:** `AuditVault.sol`
- **Network:** Mantle Sepolia Testnet
- **Address:** `0x25ac2ab1369001F9C847e65f010B6e4f4340d78a`
- **Explorer:** https://sepolia.mantlescan.xyz/address/0x25ac2ab1369001F9C847e65f010B6e4f4340d78a
- **Network:** Arbitrum Sepolia Testnet
- **Address:** `0x25ac2ab1369001F9C847e65f010B6e4f4340d78a`
- **Explorer:** https://sepolia.arbiscan.io/address/0x25ac2ab1369001F9C847e65f010B6e4f4340d78a
- **Verification:** Sourcify ✅

---

## Documentation
- [Payload best practices — privacy without losing compliance](docs/payload-best-practices.md)
-
## License
-
- MIT © AgentAudit Contributors
