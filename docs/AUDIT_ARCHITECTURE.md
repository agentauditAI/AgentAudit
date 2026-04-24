# AgentAudit — Audit Architecture

## Overview

AgentAudit provides immutable, on-chain audit logging for AI agents. Every action taken by a registered agent is recorded on-chain and cannot be altered or deleted.

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
- Deployed on Mantle Mainnet: `0xAF9ccA0C3D79900576557329F57824A0e277`

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
| Mantle Mainnet | ✅ Live (v2) | `0xAF9ccA0C3D79900576557329F57824A0e277` |
| Arbitrum One | 🔄 Planned | TBD |

## Design Principles

- **Immutability** — logs cannot be modified after submission
- **Transparency** — all logs publicly queryable
- **Gas efficiency** — batch operations minimize transaction costs
- **Modularity** — plugins for major agent frameworks (ElizaOS first)