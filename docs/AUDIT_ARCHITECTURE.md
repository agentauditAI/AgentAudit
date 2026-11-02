# AgentAudit — Audit Architecture

## Overview

AgentAudit provides tamper-evident audit logging for AI agents. Each logged action is hashed (action_ref) and batches are anchored on-chain as a Merkle root, so any later change to a logged record is detectable. Only actions the agent actually logs are covered; AuditVault v2 anchors show that a root existed at block T, not who committed it.

## Core Components

### 1. AuditVault.sol (v1 — deployed)
- Stores audit logs on-chain
- Each log entry contains: agent address, action type, timestamp, metadata hash
- Deployed on Mantle Mainnet: `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b`

### 2. AgentRegistration.sol (v2 — deployed)
- On-chain registry for AI agents
- Issues Soulbound Tokens (SBT) as agent identity
- Deployed on Mantle Mainnet: `0x68769980879414e8f264Ac15a87813E2ABaBaD6e`

### 3. AgentAuditBatch.sol (v2 — deployed)
- Gas-optimized batch logging
- Supports high-frequency agent activity
- Mantle Mainnet address: not recorded in `deployments/` (the address previously listed here was malformed); see `deployments/` for verified deployment records

### 4. TypeScript SDK (@agentaudit-xyz/sdk)
- Developer interface for agent registration and log submission
- Compatible with ElizaOS plugin architecture

## Data Flow

    AI Agent → SDK → AgentRegistration (SBT) → AuditVault → On-chain log
                                              ↓
                                     Regulator / Auditor query

## Supported Networks

| Network | Status | Contract |
|---------|--------|----------|
| Mantle Mainnet | ✅ Live (v1) | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` |
| Mantle Mainnet | ✅ Live (v2) | `0x68769980879414e8f264Ac15a87813E2ABaBaD6e` |
| Mantle Mainnet | Not verified (v2, AgentAuditBatch) | Not recorded — see `deployments/` |
| Arbitrum One | 🔄 Planned | TBD |

## Design Principles

- **Tamper-evident** — log hashes are anchored on-chain, so any change is detectable
- **Transparency** — all logs publicly queryable
- **Gas efficiency** — batch operations minimize transaction costs
- **Modularity** — plugins for major agent frameworks (ElizaOS first)