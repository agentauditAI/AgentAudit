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

Verified on-chain (`eth_getCode` plus a contract-specific function selector) on 2026-11-02. Addresses come from `deployments/`.

| Contract | Network(s) | Address | Status |
|---|---|---|---|
| AuditVault v2 (batch logging, Merkle roots) | Base | `0xCeE831070aa9081422f30df5559c125aa47A75DB` | Live — batch logging is on Base only |
| IncidentRegistry v2 (Art. 73) | Base, Arbitrum One, Mantle, Polygon | `0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F` | Live |
| IncidentRegistry v2 (Art. 73) | Optimism | `0x976b03a2417cf7926813605F427ED499fdF61e10` | Live |
| AuditVault v1 (per-action logs) | Mantle | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | Live |
| AgentRegistration (KYA) | Mantle | `0x68769980879414e8f264Ac15a87813E2ABaBaD6e` | Live |
| AuditVault v3 | — | — | Implemented and tested, not deployed (design: `docs/design/AUDITVAULT_V3.md`; target Base + Celo) |

AgentAuditBatch (section 3) has no recorded address in `deployments/` and is not listed here.

## Design Principles

- **Tamper-evident** — log hashes are anchored on-chain, so any change is detectable
- **Transparency** — all logs publicly queryable
- **Gas efficiency** — batch operations minimize transaction costs
- **Modularity** — plugins for major agent frameworks (ElizaOS first)