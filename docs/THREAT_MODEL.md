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

## Known issues — AuditVault v2

`contracts/v2/AuditVault.sol` is deployed and is not being changed. Both issues
below are therefore handled by the verifier, not by the contract.

### KI-1. `commitBatch` has no access control
**Issue:** `commitBatch` (and `commitHighRiskEvent`) accept any caller and do
not check that `agentId` is registered. Anyone can append batches under any
agent address, including roots that do not correspond to real agent activity.
**Impact:** A batch existing under an agent address does not prove the agent's
operator committed it. Batch counts and `getLatestComplianceScore` can be
inflated or polluted by third parties.
**Verifier mitigation:** Read `LogBatch.submitter` (from `getBatch`) and accept
the batch only if the submitter is an address authorized for that agent (the
operator / SDK signer recorded at registration). Ignore batches from any other
submitter.

### KI-2. Internal Merkle node accepted as a leaf
**Issue:** `verifyLog` hashes leaves and internal nodes identically
(`keccak256` of the sorted pair, no domain separation) and does not hash the
leaf itself. Any internal node of a committed tree, presented with the shorter
proof above it, also returns `true`.
**Impact:** `verifyLog(...) == true` alone does not prove the presented
`bytes32` is a real `action_ref`.
**Verifier mitigation:** Never trust the leaf value. Obtain the preimage from
the batch payload behind `contentURI` and recompute
`action_ref = SHA-256(JCS(preimage))` (docs/EVIDENCE_SCHEMA.md) yourself; only
then call `verifyLog` with that recomputed value. An internal node has no
valid JSON preimage, so it cannot pass this check.

## Out of Scope

- Runtime execution environment security (OS, container)
- LLM model-level vulnerabilities (hallucinations, prompt injection)
- Network-level attacks (MEV, front-running)

## Version

Threat Model v1.0 — AgentAudit, 2026