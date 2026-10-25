# Changelog — AgentAudit ElizaOS plugin

Versioned separately from `@agentauditai/sdk`. Not published to npm.

## 1.1.0 — unreleased

### Changed
- **Built on `@agentauditai/sdk` ^1.1.1 with batch anchoring.** `LOG_AUDIT`,
  `LOG_AUDIT_BATCH` and the auto-log middleware now buffer one `action_ref` per
  action (scope `agent_action:elizaos:record_hash:<sha256>`, docs/EVIDENCE_SCHEMA.md
  §2.5) and anchor Merkle roots via AuditVault v2 `commitBatch`.
  - `LOG_AUDIT` buffers by default; `flush: true` anchors immediately. The
    callback now carries `actionRef`, `payloadHash` (SHA-256), `pending`, and
    `txHash` / `batchId` once anchored.
  - `LOG_AUDIT_BATCH` anchors its actions in one `commitBatch` right away and
    returns `actionRefs`.
  - The middleware no longer awaits the chain at all.
- `AUDIT_STATUS` reports batch-anchoring availability, the on-chain batch count
  (`getBatchCount` for the signer) and pending entries, instead of `getLogCount`.
- `REGISTER_AGENT` goes through the SDK (same contract, same defaults).
- Networks and addresses come from the SDK (`NETWORKS`), so the Base address is
  the verified AuditVault v2 deployment.
- `payloadHash` is now `sha256:<hex>` of the content (was keccak256).

### Added
- Optional config: `AUDIT_BATCH_DIR` (batch JSON files, default
  `./agentaudit-batches`, hashes only), `AUDIT_RPC_URL`, `AUDIT_VAULT_ADDRESS`.
- `plugin.batch.{flush, close, pending, getInclusionProof}`.

### Unchanged
- Action names, `validate` rules and all existing env var names.
- `REPORT_INCIDENT` and `RECORD_METRIC` keep their direct contract calls: the
  SDK equivalents re-hash `options.agentId` and re-encode `options.txRef`,
  which would change the data written on-chain.

### Fixed
- `LOG_AUDIT`, `LOG_AUDIT_BATCH`, auto-log and `AUDIT_STATUS` called
  `logAction` / `logActionBatch` / `getLogCount`, which no deployed AuditVault
  implements — every call reverted (or, on Base before the address fix, went to
  an address with no code).

### Known limitations
- Batch anchoring works by default only on **Base**. Arbitrum, Optimism and
  Polygon default contracts are not AuditVault v2, and Mantle (the default
  `AUDIT_NETWORK`) is v1 — logging there fails with a clear error unless
  `AUDIT_VAULT_ADDRESS` points at an AuditVault v2 deployment.
- TODO: `RECORD_METRIC` uses `options?.metricType || 3`, so `metricType: 0`
  (ERROR_RATE) silently becomes `3` (COMPLIANCE_SCORE). `REPORT_INCIDENT` has
  the same `||` pattern for `severity` (`0` LOW becomes `1` MEDIUM). Fix with `??`.
- Batch history is kept in memory for `getInclusionProof`; after a restart,
  proofs must be rebuilt from the batch files.
- Default `AUDIT_NETWORK` stays `mantle`: Base has no recorded PostMarketMonitor
  deployment, so the default could not move there without breaking
  `RECORD_METRIC`. Set `AUDIT_NETWORK=base` for batch logging.
- `REPORT_INCIDENT` sends the 5-argument
  `registerIncident(bytes32,uint8,string,string,uint256)`, but
  `contracts/v2/IncidentRegistry.sol` (and the IncidentRegistry deployed on Base,
  `0x6ad4…EA6F`) only implements the 7-argument
  `registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256)`
  (adds `harmType`, `affectedPersons`); the call reverts there. The SDK's
  `reportIncident()` has the same ABI. Not changed in this release.

## 1.0.0

- Initial version: 6 actions and auto-log middleware using `ethers` directly.
