Payload Best Practices — Privacy Without Losing Compliance
AuditVault logs are public on-chain. Never write sensitive business logic in plaintext.
Use hashed payloads: the on-chain anchor only has to show that a log record existed unchanged; the full record stays in your own storage for the retention period.
> **Rule of thumb:** Store full data in your private database. Log only the hash on-chain.
> The anchor proves a record's existence and integrity, not its content.
---
❌ What NOT to do
```typescript
// BAD — reveals exact trade logic to any on-chain observer
await sdk.logAction({
  agentId,
  sessionId,
  actionType: "TRADE",
  payload: JSON.stringify({
    token: "USDC",
    amount: "50000",
    targetPrice: "0.9982",   // ← competitor sees your strategy
    exchange: "Uniswap V3",
    slippage: "0.1%"
  })
});
```
Problem: Anyone watching the blockchain sees your exact trade parameters, amounts, and exchange routing.
---
✅ Recommended pattern — hashed payload
```typescript
import { createHash } from "crypto";

// 1. Keep full data in YOUR private database
const sensitiveData = {
  token: "USDC",
  amount: "50000",
  targetPrice: "0.9982",
  exchange: "Uniswap V3",
  timestamp: Date.now()
};

// Store to your DB here
await yourDatabase.save({ id: sessionId, data: sensitiveData });

// 2. Compute SHA-256 hash of the full payload
const payloadHash = createHash("sha256")
  .update(JSON.stringify(sensitiveData))
  .digest("hex");

// 3. Log only the hash on-chain
await sdk.logAction({
  agentId,
  sessionId,
  actionType: "TRADE",
  payload: `sha256:${payloadHash}`   // ← hash only, zero raw data
});
```
What goes on-chain: `sha256:3a7bd3e2b6...` — meaningless to competitors.
What stays off-chain: Full trade data in your private database.
How to prove compliance: Show regulator the original data → compute hash → matches on-chain record → log is authentic and tamper-evident (anchored on-chain, any change is detectable).
---
How compliance verification works
```
Your private DB          AuditVault (on-chain)
─────────────────        ─────────────────────
{ token: "USDC",   →→→  sha256: 3a7bd3e2b6f1...
  amount: 50000,         timestamp: 1712345678
  exchange: Uniswap }    blockNumber: 14829301

Regulator:
  hash(private data) === on-chain hash? ✅ → log verified
```
---
EU AI Act articles this supports (evidence, not compliance)
Article	Requirement	How hashed logging provides evidence
Art. 12	Record-keeping (automatic event logging)	Logging is automatic; the anchored hash makes any later change to a record detectable
Art. 19	Automatically generated logs	Full records stay off-chain and remain verifiable against the anchors; retention is the operator's job
Art. 26	Deployer obligations	Deployer-held logs that third parties can verify
---
Quick reference — recommended actionType values
Use generic, non-revealing action type labels:
```typescript
// ✅ Good — descriptive but not revealing
"FINANCIAL_DECISION"
"API_CALL"
"DAO_VOTE"
"DATA_ACCESS"
"POLICY_CHECK"
"AGENT_INIT"
"AGENT_SHUTDOWN"

// ❌ Avoid — too specific
"BUY_USDC_UNISWAP"
"SELL_ETH_AT_1800"
```
---
Full TypeScript example with hashing utility
```typescript
import { createHash } from "crypto";
import { AgentAuditSDK } from "@agentaudit/sdk";

const sdk = new AgentAuditSDK({
  contractAddress: "0x25ac2ab1369001F9C847e65f010B6e4f4340d78a",
  network: "mantle-sepolia"
});

/**
 * Hash any object and return a log-safe string.
 * Store the original data in your own database before calling this.
 */
function hashPayload(data: object): string {
  return "sha256:" + createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
}

// Usage
const sensitivePayload = {
  action: "token_swap",
  from: "ETH",
  to: "USDC",
  amount: "1.5",
  price: "3240.50"
};

await yourDatabase.save({ sessionId, payload: sensitivePayload });

await sdk.logAction({
  agentId: "0xabc...def",
  sessionId: "0x123...456",
  actionType: "FINANCIAL_DECISION",
  payload: hashPayload(sensitivePayload)
});
```
---
AgentAudit — getagentaudit.xyz | Tamper-evident, on-chain-anchored audit logs for AI agents.
