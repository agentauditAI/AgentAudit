# AgentAudit — Investor & Grant Pitch

> **Immutable on-chain audit logs for AI agents. EU AI Act compliant.**

---

## The Problem

AI agents are executing financial transactions, approving payments, and interacting with external systems — autonomously. In Q1 2026 alone, **$45M was lost to AI agent exploits**.

When something goes wrong, there's no reliable audit trail. Off-chain logs can be modified. Databases can be wiped. **On-chain logs cannot.**

---

## The Solution

AgentAudit writes every AI agent decision directly to the blockchain — tamper-proof, timestamped, permanently auditable.

One SDK call. One immutable record. Full compliance.
```typescript
await audit.log({
  action: 'TRANSFER_APPROVED',
  metadata: JSON.stringify({ amount: '100 USDC', recipient: '0x...', reason: 'Invoice #4421' }),
});
```

---

## Live Deployments ✅

| Network | Address | Explorer |
|---|---|---|
| **Arbitrum Sepolia** | `0x25ac2ab1369001F9C847e65f010B6e4f4340d78a` | [arbiscan.io](https://sepolia.arbiscan.io/address/0x25ac2ab1369001F9C847e65f010B6e4f4340d78a) |
| **Mantle Sepolia** | `0x25ac2ab1369001F9C847e65f010B6e4f4340d78a` | [mantlescan.xyz](https://sepolia.mantlescan.xyz/address/0x25ac2ab1369001F9C847e65f010B6e4f4340d78a) |

Contract verified on Sourcify ✅

---

## EU AI Act Compliance

| Article | Requirement | AgentAudit |
|---|---|---|
| Art. 12 | Record-keeping for high-risk AI | ✅ Immutable on-chain logs |
| Art. 13 | Transparency to users | ✅ Every action timestamped & readable |
| Art. 14 | Human oversight capability | ✅ Full audit trail for review |
| Art. 17 | Quality management documentation | ✅ Structured metadata per entry |

**No direct competitors.** Existing solutions store logs off-chain or in centralized databases — defeating the purpose.

---

## Traction

- ✅ AuditVault.sol deployed on **2 testnets** (Arbitrum + Mantle)
- ✅ TypeScript SDK published (`@agentaudit/sdk` v0.1.0-alpha)
- ✅ Contract verified on Sourcify
- ✅ Part of the **RunLockAI** AI agent infrastructure stack
- 🔗 Sister project: [ShieldAI](https://getshieldai.xyz) — runtime security for AI agents

---

## Market

- EU AI Act enforcement begins **August 2026** — every high-risk AI deployment needs compliant logging
- 50M+ AI agents projected active by end of 2026
- Zero on-chain audit solutions exist today

---

## Ask

We are applying for infrastructure grants to:
1. Deploy to Arbitrum Mainnet & Mantle Mainnet
2. Build dashboard UI for log visualization
3. IPFS metadata pinning for immutable off-chain references
4. W3C Verifiable Credential export

---

## Team

- **Solo founder** — hybrid technical/business profile
- Partner (legal) — EU AI Act compliance advisory
- Built under [RunLockAI](https://runlock.ai) umbrella

---

## Links

- 🌐 Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- 📦 GitHub: [github.com/agentauditAI/AgentAudit](https://github.com/agentauditAI/AgentAudit)
- 🛡️ ShieldAI: [getshieldai.xyz](https://getshieldai.xyz)
- 🏗️ RunLockAI: [runlock.ai](https://runlock.ai)
