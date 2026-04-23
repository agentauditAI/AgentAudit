# KYA — Know Your Agent Standard

## Overview

KYA (Know Your Agent) is an open standard for AI agent identity, accountability, and auditability. Inspired by KYC (Know Your Customer) in finance, KYA applies the same principle to autonomous AI agents operating on-chain.

## Why KYA?

AI agents are increasingly executing financial transactions, signing contracts, and making decisions with real-world consequences. Without a verifiable identity and audit trail, there is no accountability.

KYA defines what every deployed AI agent must declare:
- Who created it
- What it is authorized to do
- What it has done (immutable log)
- Whether it complies with applicable regulations

## Core KYA Fields

| Field | Description | Required |
|-------|-------------|----------|
| `agent_id` | Unique on-chain identifier (SBT or registry address) | ✅ |
| `agent_name` | Human-readable name | ✅ |
| `operator` | Wallet address of the deploying entity | ✅ |
| `created_at` | Deployment timestamp | ✅ |
| `authorized_actions` | List of permitted action types | ✅ |
| `spend_limit` | Max token spend per transaction / per day | ✅ |
| `audit_vault` | Address of the AuditVault contract logging this agent | ✅ |
| `compliance_level` | EU AI Act risk classification (minimal/limited/high) | ✅ |
| `revoked` | Whether the agent has been deregistered | ✅ |

## KYA Lifecycle

1. **Registration** — Agent is registered on-chain via `AgentRegistration.sol`
2. **Operation** — Every action is logged to `AuditVault` (immutable)
3. **Review** — Logs are queryable by regulators, auditors, or users
4. **Revocation** — Agent can be deregistered; logs remain permanently

## Relationship to EU AI Act

KYA directly supports compliance with:
- **Article 12** — Record-keeping for high-risk AI systems
- **Article 13** — Transparency obligations
- **Article 19** — Logging requirements
- **Article 26** — Obligations for deployers
- **Article 72** — Post-market monitoring obligations for high-risk AI providers
- **Article 9** — Risk management system documentation for high-risk AI

## Timeline

EU AI Act enforcement for high-risk AI systems: **August 2, 2026**.
AgentAudit provides compliance-ready infrastructure today.                             

## Version

KYA Standard v1.0 — AgentAudit, 2026