# AgentAudit — Compliance Mapping

## Overview

This document maps AgentAudit features to the EU AI Act obligations they support or provide evidence for. AgentAudit does not by itself make a system compliant. Annex III high-risk obligations apply from 2 Dec 2027 (Digital Omnibus).

## Article-by-Article Mapping

| EU AI Act Article | Obligation | AgentAudit Feature |
|-------------------|------------|-------------------|
| Article 9 | Risk management system | On-chain audit trail as risk evidence |
| Article 12 | Record-keeping | AuditVault tamper-evident logs (Merkle roots anchored on-chain) |
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
3. Agent actions logged via the SDK are anchored to AuditVault in Merkle batches
4. Logs are queryable by regulators, auditors, or users at any time
5. Agent can be revoked; on-chain anchors remain as evidence, and the operator retains the off-chain records

## Target Users

- AI agent developers who need evidence for EU AI Act record-keeping
- Enterprises deploying autonomous agents in regulated industries
- Auditors and regulators requiring verifiable AI activity records

## Status

Checked on-chain (`eth_getCode`) on 2026-11-02:

- **Batch logging** (AuditVault v2, Merkle roots of action_refs): live on Base mainnet only.
- **IncidentRegistry v2** (Art. 73): live on Base, Arbitrum One, Optimism, Polygon and Mantle.
- **AgentRegistration** (KYA, Art. 26) and **AuditVault v1** (per-action logs): live on Mantle.
- **AuditVault v3** (EIP-712-signed batches, per-agent hash chain, RFC 6962 trees, ERC-8004 identity): implemented and tested, not deployed.

Addresses: `deployments/` and the "Supported Networks" section of `sdk/README.md`.