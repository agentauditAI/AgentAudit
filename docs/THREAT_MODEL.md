# AgentAudit — Threat Model

## Overview

This document identifies key threats to AI agent security and explains how AgentAudit mitigates them.

## Threat Categories

### 1. Unauthorized Agent Actions
**Threat:** AI agent executes actions outside its authorized scope.
**Mitigation:** KYA fields define authorized_actions on-chain. Any out-of-scope action is flagged in the audit log.

### 2. Spend Limit Violations
**Threat:** AI agent overspends allocated token budget.
**Mitigation:** spend_limit field enforced at registration. Violations recorded as anomaly events in AuditVault.

### 3. Identity Spoofing
**Threat:** Malicious actor impersonates a legitimate AI agent.
**Mitigation:** Soulbound Token (SBT) binds agent identity to deployer wallet. Non-transferable by design.

### 4. Log Tampering
**Threat:** Audit logs are modified or deleted to hide malicious activity.
**Mitigation:** AuditVault stores logs immutably on-chain. No admin can alter or delete records.

### 5. Unregistered Agent Operation
**Threat:** AI agent operates without any registration or oversight.
**Mitigation:** AgentRegistration.sol required before agent can interact with AgentAudit infrastructure.

### 6. Private Key Compromise
**Threat:** Deployer wallet private key is leaked, enabling agent hijacking.
**Mitigation:** Agent revocation mechanism allows immediate deregistration. All prior logs preserved as evidence.

### 7. Regulatory Non-Compliance
**Threat:** AI agent operates without meeting EU AI Act obligations.
**Mitigation:** Full KYA registration + AuditVault logging satisfies Articles 9, 12, 13, 19, 26, 72.

## Out of Scope

- Runtime execution environment security (OS, container)
- LLM model-level vulnerabilities (hallucinations, prompt injection)
- Network-level attacks (MEV, front-running)

## Version

Threat Model v1.0 — AgentAudit, 2026