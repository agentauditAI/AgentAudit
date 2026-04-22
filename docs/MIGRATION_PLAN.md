# AgentAudit — Migration & Consolidation Plan

**Status:** Phase 1 complete | **Last updated:** April 22, 2026 | **Owner:** Piotr + Ewelina

This document outlines the migration from the current split-repo setup
(`agentauditAI/AgentAudit` + legacy dev repository) into a single
consolidated repository with a clean Foundry + EAS-based v2 architecture.

---

## Context

AgentAudit development initially lived across two repositories during the
early prototyping phase. As the project matured, we consolidated all
unique work into `agentauditAI/AgentAudit` — the public-facing repository
hosting `getagentaudit.xyz` via GitHub Pages and linked in the NGI Zero
Commons Fund grant application (Code: 2026-06-098).

The Mantle Mainnet deployment of AuditVault v1 lives at:
`0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b`

Consolidation goal: have one repository that grant reviewers, auditors,
and integration partners can navigate end-to-end.

---

## Goals

1. Single source of truth at `agentauditAI/AgentAudit`
2. Zero loss of historical work (ElizaOS plugin, deploy scripts, Mainnet artifacts)
3. Clean folder structure readable by external parties
4. EAS-based v2 architecture (replacing custom AuditVault v1)
5. All future work in cloud (GitHub Codespaces) — no local machine dependency
6. Documentation aligned with EU AI Act Articles 12, 13, 19, 26

---

## Non-Goals

- Rewriting the SDK from scratch
- Migrating the Mantle Mainnet contract (v1 stays deployed as historical record)
- Building a "combined" product with enforcement layer — positioning is
  "on-chain evidence layer, complementary to enforcement tools like Nobulex"

---

## Migration Phases

### Phase 0 — Prerequisites

- [x] Confirm Codespaces-only workflow
- [x] Confirm both co-founders aligned on consolidation approach

### Phase 1 — Repository Consolidation

- [x] Create branch `feat/consolidate-dev-workspace` in `agentauditAI/AgentAudit`
- [x] Copy unique files from legacy dev repository:
  - `plugin-elizaos/`
  - `scripts/` (including Mantle Mainnet deploy scripts)
  - `hardhat.config.js` (legacy v1 config, reference)
  - `package.json`, `package-lock.json`
  - `tsconfig.json`
- [x] Open PR, review, merge (PR #1, commit `09de925`)
- [x] Verify `getagentaudit.xyz` still works, GitHub Pages still deploys
- [x] Local main synced, feature branch deleted

**Deferred tasks** (do not block Phase 2 start):

- Archival of the legacy dev repository — pending access coordination. Tracked separately; will be completed before public launch of v2.
- Update of the "GitHub" button in `getagentaudit.xyz/index.html` to point at `https://github.com/agentauditAI/AgentAudit` — moved into Phase 2 folder-restructure tasks.

#### Draft — redirect notice for legacy repository

When archival becomes possible, prepend the following markdown to the top of the legacy repository's `README.md`:

~~~markdown
# ⚠️ This Repository Has Moved

**AgentAudit development has consolidated to [agentauditAI/AgentAudit](https://github.com/agentauditAI/AgentAudit).**

Please use the new repository for:
- Latest code and SDK
- Documentation and grant materials
- Issues, PRs, and contributions

Website: [getagentaudit.xyz](https://getagentaudit.xyz)

This repository is preserved as a historical reference and will be archived in the near future.
~~~

### Phase 2 — Folder Restructure

Target structure:

- `contracts/v1/` (legacy custom AuditVault)
- `contracts/v2/` (Foundry + EAS-based, new work)
- `contracts/deployments/` (addresses per network)
- `sdk/` (TypeScript SDK)
- `plugins/elizaos/`
- `scripts/`
- `docs/` (KYA_STANDARD, AUDIT_ARCHITECTURE, COMPLIANCE_MAPPING, THREAT_MODEL, MIGRATION_PLAN)
- `website/` (index.html, CNAME)
- `README.md`, `PITCH.md`, `LICENSE`

Tasks:

- [ ] Split existing KYA documentation into four separate documents
- [ ] Rewrite README.md with clear positioning and architecture diagram
- [ ] Add compatibility note for Nobulex integration
- [ ] Document contract addresses per network
- [ ] Update GitHub button link in `index.html`

### Phase 3 — Foundry + EAS Setup

- [ ] Install Foundry in Codespace devcontainer
- [ ] Set up `contracts/v2/` with Foundry project structure
- [ ] Design EAS schemas:
  - `AgentRegistration` (DID, owner, model fingerprint, prompt hash, capabilities)
  - `AgentAuditBatch` (agent DID, Merkle root, sequence range, storage URI)
- [ ] Register schemas on easscan.org (Mantle Sepolia first)
- [ ] Write AuditVault.sol v2 as thin EAS wrapper + agent registry
- [ ] Scaffold Foundry tests (unit + fuzzing)

### Phase 4 — Implementation

- [ ] Implement AuditVault.sol v2
- [ ] Write Foundry tests (aim for high coverage)
- [ ] Deploy to Mantle Sepolia
- [ ] Update SDK with EAS adapter
- [ ] Build reference example (minimal agent using v2 SDK)
- [ ] Update README with v2 Sepolia address

### Phase 5 — Post-Migration

- [ ] Deploy v2 to Mantle Mainnet
- [ ] Announce migration (tweet + Mirror post)
- [ ] Update grant statuses (NGI Zero, Giveth)
- [ ] Outreach to Nobulex (complementary partnership)
- [ ] First pilot integration (ElizaOS or LangChain agent)

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| Loss of Mantle Mainnet v1 deploy history | Keep `contracts/v1` as legacy, document address in README |
| CNAME / GitHub Pages breaks during consolidation | Test in branch before merge to main |
| Legacy repo archival loses unreplicated content | Audit every file before archival (done in Phase 1) |
| Migration happens during fatigued late-night session | Explicit rule: consolidation work only during fresh-head hours |

---

## Success Criteria

- A new contributor can clone the repo, read README, and understand AgentAudit within 5 minutes
- All code lives in one repository
- Legacy dev repository is archived (read-only, preserved)
- EU AI Act Article 12/13/19/26 compliance mapping is documented
- v2 contract is deployed on Mantle Sepolia with passing tests
- All development happens exclusively in GitHub Codespaces

---

## References

- NGI Zero submission code: `2026-06-098`
- Mantle Mainnet AuditVault v1: `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b`
- Nobulex (complementary project): https://github.com/arian-gogani/nobulex
- EAS documentation: https://docs.attest.org
- Target legal framework: EU AI Act (Regulation 2024/1689), enforcement August 2, 2026