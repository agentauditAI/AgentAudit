# Changelog — @agentauditai/mcp-server

All notable changes to this package. Versions follow [SemVer](https://semver.org/).

## 3.0.0 — 2026-11-08

AgentAudit provides evidence, not certification. This release removes every tool
output that read as a compliance verdict.

### Breaking
- **`check_conformity` removed.** The server no longer reads ConformityAssessment.
  The deployed contract is unchanged; read it directly if you need the record.
- **Evidence report output changed.** The ConformityAssessment section is gone and
  the report lists on-chain records with a disclaimer instead of a verdict.
- **`report_incident` no longer prints a reporting deadline.** Deadlines depend on
  the type of incident; confirm them with your legal team. The tool states that it
  creates an on-chain record, not a report to an authority.

### Added
- `get_evidence_report`. `get_compliance_report` stays as a deprecated alias and
  will be removed in a future major version.
- **Base Builder Code attribution (ERC-8021), on by default** for `audit_action`
  and `report_incident`, on Base (8453) and Base Sepolia (84532) only. Appends a
  29-byte suffix for `bc_pd681w25`; evidence bytes are unchanged, only the tx hash
  differs. Turn it off with `AGENTAUDIT_BUILDER_CODE=false` (also `off`, `0`), or
  set your own code. An invalid value stops the server at startup.
- "Not legal advice." in evidence and incident tool descriptions and output.

### Changed
- MCP handshake version `3.0.0`.
- `CHANGELOG.md` now ships in the package.

## 2.0.0 — 2026-10-30

First npm release: `audit_action` (AuditVault v2 `commitBatch` on Base),
`get_audit_log`, `verify_proof`, `report_incident` (IncidentRegistry v2, 5
networks), `get_compliance_report`, `get_risk_score`, `check_conformity`.
