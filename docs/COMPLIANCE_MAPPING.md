# AgentAudit — Compliance Mapping

## Overview

This document maps AgentAudit features to specific EU AI Act obligations for high-risk AI systems. Enforcement deadline: **August 2, 2026**.

## Article-by-Article Mapping

| EU AI Act Article | Obligation | AgentAudit Feature |
|-------------------|------------|-------------------|
| Article 9 | Risk management system | On-chain audit trail as risk evidence |
| Article 12 | Record-keeping | AuditVault immutable logs |
| Article 13 | Transparency | Public log queryability |
| Article 19 | Logging requirements | Automatic per-action logging |
| Article 26 | Deployer obligations | AgentRegistration + KYA fields |
| Article 72 | Post-market monitoring | Continuous on-chain activity log |

## Risk Classification Support

AgentAudit supports all three EU AI Act risk levels:

- **Minimal risk** — basic logging, no SBT required
- **Limited risk** — full logging + transparency disclosure
- **High risk** — full KYA registration + SBT + continuous monitoring

## Compliance Workflow

1. Developer registers agent via AgentRegistration.sol
2. KYA fields are recorded on-chain (identity, permissions, spend limits)
3. Every agent action is logged to AuditVault automatically
4. Logs are queryable by regulators, auditors, or users at any time
5. Agent can be revoked; logs remain permanently as evidence

## Target Users

- AI agent developers seeking EU AI Act compliance
- Enterprises deploying autonomous agents in regulated industries
- Auditors and regulators requiring verifiable AI activity records

## Status

AgentAudit v1 is live on Mantle Mainnet. Full KYA compliance stack (v2) in active development — targeting deployment before August 2, 2026.