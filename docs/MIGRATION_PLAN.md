# AgentAudit — Migration & Consolidation Plan

**Status:** Draft | **Last updated:** April 20, 2026 | **Owner:** Piotr + Ewelina

This document outlines the migration from the current split-repo setup
(`agentauditAI/AgentAudit` + `agentaudit-xyz/AgentAudit`) into a single
consolidated repository with a clean Foundry + EAS-based v2 architecture.

---

## Context

AgentAudit currently lives across two repositories:

- **`agentauditAI/AgentAudit`** (this repo) — Public-facing, owned under the
  `agentauditAI` organization. Hosts `getagentaudit.xyz` via GitHub Pages.
  Linked in NGI Zero grant application (Code: 2026-06-098).
  Contains: README, PITCH.md, docs/, sdk/src/, CNAME, index.html.

- **`agentaudit-xyz/AgentAudit`** — Development workspace. Contains the
  actual working code: contracts/, plugin-elizaos/, scripts/ (including
  Mantle Mainnet deploy), hardhat.config.js, package.json.
  Mantle Mainnet deploy of AuditVault v1 lives at:
  `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b`

This split is not intentional — it's historical. Consolidation goal is to
have one repository that grant reviewers, auditors, and integration
partners can navigate end-to-end.

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

- Rewriting SDK from scratch
- Migrating Mantle Mainnet contract (v1 stays deployed as historical record)
- Building a "combined" product with enforcement layer — positioning is
  "on-chain evidence layer, complementary to enforcement tools like Nobulex"
- Any work on personal/corporate device boundaries — all work happens in
  GitHub Codespaces

---

## Migration Phases

### Phase 0 — Prerequisites (Monday morning)

- [ ] Review employment contract (IP clauses, non-compete)
- [ ] Confirm Codespaces-only workflow is legally clean
- [ ] Confirm both co-founders aligned on consolidation approach

### Phase 1 — Repository Consolidation (Tuesday)

- [ ] Create branch `feat/consolidate-dev-workspace` in `agentauditAI/AgentAudit`
- [ ] Copy from `agentaudit-xyz/AgentAudit`:
  - [ ] `plugin-elizaos/` -> `plugins/elizaos/`
  - [ ] `scripts/` -> `scripts/`
  - [ ] `hardhat.config.js` -> root (as v1 legacy reference)
  - [ ] `package.json`, `package-lock.json` -> root (merge if exists)
  - [ ] `tsconfig.json` -> root
- [ ] Update README.md with consolidated structure
- [ ] Open PR, review, merge
- [ ] Verify `getagentaudit.xyz` still works, GitHub Pages still deploys
- [ ] Archive `agentaudit-xyz/AgentAudit` (Settings -> Danger Zone -> Archive)

### Phase 2 — Folder Restructure (Wednesday)

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

### Phase 3 — Foundry + EAS Setup (Thursday)

- [ ] Install Foundry in Codespace devcontainer
- [ ] Set up `contracts/v2/` with Foundry project structure
- [ ] Design EAS schemas:
  - [ ] `AgentRegistration` (DID, owner, model fingerprint, prompt hash, capabilities)
  - [ ] `AgentAuditBatch` (agent DID, Merkle root, sequence range, storage URI)
- [ ] Register schemas on easscan.org (Mantle Sepolia first)
- [ ] Write AuditVault.sol v2 as thin EAS wrapper + agent registry
- [ ] Scaffold Foundry tests (unit + fuzzing)

### Phase 4 — Implementation (Friday + weekend)

- [ ] Implement AuditVault.sol v2
- [ ] Write Foundry tests (aim for high coverage)
- [ ] Deploy to Mantle Sepolia
- [ ] Update SDK with EAS adapter
- [ ] Build reference example (minimal agent using v2 SDK)
- [ ] Update README with v2 Sepolia address

### Phase 5 — Post-Migration (Week 2)

- [ ] Deploy v2 to Mantle Mainnet
- [ ] Announce migration (tweet + Mirror post)
- [ ] Update grant statuses (NGI Zero, Giveth)
- [ ] Outreach to Nobulex (complementary partnership)
- [ ] First pilot integration (ElizaOS or LangChain agent)

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| Loss of Mantle Mainnet v1 deploy history | Keep contracts/v1 as legacy, document address in README |
| CNAME / GitHub Pages breaks during consolidation | Test in branch before merge to main |
| agentaudit-xyz archival loses unreplicated content | Audit every file before archival |
| Local SAMEY laptop retains project artifacts | Phase 0 cleanup: remove all AgentAudit folders and keys |
| Migration happens during fatigued late-night session | Explicit rule: consolidation work only during fresh-head hours |

---

## Success Criteria

- A new contributor can clone the repo, read README, and understand AgentAudit within 5 minutes
- All code lives in one repository
- agentaudit-xyz/AgentAudit is archived (read-only, preserved)
- EU AI Act Article 12/13/19/26 compliance mapping is documented
- v2 contract is deployed on Mantle Sepolia with passing tests
- Zero AgentAudit artifacts remain on SAMEY Robotics hardware
- All future development happens exclusively in GitHub Codespaces

---

## References

- NGI Zero submission code: 2026-06-098
- Current Mantle Mainnet AuditVault v1: `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b`
- Nobulex (complementary project): https://github.com/arian-gogani/nobulex
- EAS documentation: https://docs.attest.org
- Target legal framework: EU AI Act (Regulation 2024/1689), enforcement August 2, 2026