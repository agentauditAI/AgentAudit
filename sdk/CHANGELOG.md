# Changelog — @agentauditai/sdk

All notable changes to this package. Versions follow [SemVer](https://semver.org/).

## 1.1.1 — 2026-10-25

### Fixed
- **Batch anchoring on networks without AuditVault v2.** 1.1.0 marked
  Arbitrum One, Optimism and Polygon as AuditVault v2, but the contracts at
  their default addresses (`0x3057…450C`, `0x6fC0…de02`) are a different
  contract with no `commitBatch(address,bytes32,string,uint256,uint8)` —
  batch commits there reverted. Those networks now have `vaultVersion: null`,
  and creating a wrapper in batch mode (or calling `commitBatch`) on them
  throws a clear error: `Batch anchoring is not available on <network>: …`.
  Passing `auditVaultAddress` for an AuditVault v2 deployment still works.
  **Base is the only network with batch anchoring by default.**
- The Mantle (v1) error no longer suggests `mode: "per_action"`, which also
  reverts on-chain.

### Added
- `AgentAudit.assertBatchAnchoring()`; wrappers call it at construction in
  batch mode so misconfiguration fails fast instead of on the first flush.
  `BatchCommitter.assertBatchAnchoring?()` is optional for custom committers.

### Docs
- README "Supported Networks" now lists, per network, the default AuditVault,
  what contract it is, and whether batch anchoring works today.
- README states that batch files hold hashes only.

### Corrections to 1.1.0 notes
- The 1.1.0 entry and README listed batch anchoring as available on Arbitrum,
  Optimism and Polygon. That was wrong; only Base supports it by default.

## 1.1.0 — 2026-10-25

### Added
- **Batch anchoring (default).** `AuditedOpenAI`, `AuditedAnthropic` and
  `AgentAuditCallbackHandler` now buffer one `action_ref` per call in a
  `BatchBuffer` and anchor a single Merkle root per batch via AuditVault v2
  `commitBatch` — one transaction per batch instead of one per call
  (EU AI Act Art. 12, 19).
  - `action_ref = SHA-256(JCS(preimage))` per
    [Evidence Schema v1](https://github.com/agentauditAI/AgentAudit/blob/main/docs/EVIDENCE_SCHEMA.md);
    LLM calls use scope `llm_call:<model>:record_hash:<sha256(JCS(record))>`.
  - Merkle tree matches AuditVault v2 `verifyLog` (sorted-pair keccak256,
    unpaired node promoted). Verified against a real AuditVault v2 on anvil in CI.
  - Flush on 50 entries, 60 s after the first entry, or `flush()` / `close()`;
    failed commits are re-queued.
  - `getInclusionProof(actionRef)` → `{ leaf, proof[], root, batchId, batchIndex, agentAddress, txHash }`.
  - Pluggable `BatchStore` (`MemoryBatchStore`, `FileBatchStore`); the store URI
    becomes the on-chain `contentURI`.
- New wrapper options: `mode: "batch" | "per_action"` (default `"batch"`) and
  `batch: { buffer, agentAddress, store, maxEntries, maxAgeSeconds, complianceScore, onError }`;
  wrappers expose `buffer`.
- `AgentAudit.commitBatch()`, `AgentAudit.verifyLog()`, `auditVaultAddress`
  config override, and `vaultVersion` on each `NETWORKS` entry.
- `AgentAudit.logAction()` — alias of `log()`; the 1.0.x wrappers called this
  method but it did not exist.
- `exports` map with subpaths `@agentauditai/sdk/openai`, `/anthropic`,
  `/langchain`, `/batch`, `/AgentAuditHandler`. Deep `dist/` imports from 1.0.x
  keep working.
- `LICENSE` and this changelog are now included in the package.

### Fixed
- **Base AuditVault address.** `NETWORKS.base.auditVault` (and the
  `AgentAuditHandler` network table) pointed at `0x556C…0873`, which has no
  contract code — transactions there succeeded without recording anything. Now
  `0xCeE831070aa9081422f30df5559c125aa47A75DB`, whose runtime bytecode was
  verified against `contracts/v2/AuditVault.sol`.
- **Stale nonce on back-to-back transactions.** ethers' 250 ms RPC cache could
  return the same nonce for consecutive commits from one signer ("nonce too
  low"); the SDK provider now disables that cache.
- **Env var naming.** `createAgentAudit()` reads `AUDIT_PRIVATE_KEY` (as the
  code always did); the 1.0.x README wrongly documented
  `AGENT_AUDIT_PRIVATE_KEY`. That name is still accepted as a deprecated
  fallback.

### Changed
- Wrappers default to batch mode. Non-streaming calls resolve once the entry is
  buffered (and, if it fills the batch, once that flush completes — commit
  errors still reach the caller). Set `mode: "per_action"` for 1.0.x behaviour.

### Known limitations
- `log()` / `logBatch()` (and therefore `mode: "per_action"`) encode
  `logAction(uint256,string,bytes32,uint8)`, which the deployed AuditVault
  v1/v2 contracts do not implement; these calls revert on-chain. Use batch mode.
- AuditVault v2 `commitBatch` has no access control, and `verifyLog` accepts an
  internal Merkle node as a leaf. Verifiers must check the batch `submitter`
  and recompute `action_ref` from the preimage — see
  [docs/THREAT_MODEL.md](https://github.com/agentauditAI/AgentAudit/blob/main/docs/THREAT_MODEL.md).
- Wrappers do not return the `action_ref` of a call yet; read it from the stored
  batch (`entries[].action_ref`).
- Mantle's default AuditVault is v1; batch mode there needs `auditVaultAddress`.

## 1.0.1 — 2026-05-17

- Added the package README.

## 1.0.0 — 2026-05-17

- Initial release: `AgentAudit` client (5 networks; registration, audit
  logging, incidents Art. 73, post-market monitoring Art. 72),
  `AuditedOpenAI`, `AuditedAnthropic`, `AgentAuditCallbackHandler` /
  `withAudit()`, and `AgentAuditHandler`.
