# @agentauditai/mcp-server

MCP (Model Context Protocol) server for [AgentAudit](https://github.com/agentauditAI/AgentAudit): on-chain audit logging and incident records for AI agents, providing evidence that supports EU AI Act record-keeping. It does not determine whether any legal obligation is satisfied. Works with Claude, Cursor and any MCP client over stdio.

| What | Where it is live |
|---|---|
| Audit logging: `audit_action`, `get_audit_log`, `verify_proof` (AuditVault v2, Art. 12, 19) | **Base only**: AuditVault v2 `0xCeE831070aa9081422f30df5559c125aa47A75DB` |
| Incident records: `report_incident` (IncidentRegistry v2, related to Art. 73) | **5 networks**: mantle, base, arbitrum, optimism, polygon |
| Evidence reads: `get_evidence_report`, `get_risk_score`, `check_conformity` (related to Art. 9, 43, 44, 73) | mantle, base, arbitrum, optimism, polygon |

## Install and run

```bash
npx -y @agentauditai/mcp-server        # starts the stdio server (bin: agentaudit-mcp)
```

The package is compiled JavaScript and needs Node.js 18 or newer; it does not use ts-node at runtime.

Example MCP client config:

```json
{
  "mcpServers": {
    "agentaudit": {
      "command": "npx",
      "args": ["-y", "@agentauditai/mcp-server"],
      "env": { "PRIVATE_KEY": "0x…", "RPC_BASE": "https://…" }
    }
  }
}
```

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `PRIVATE_KEY` | `audit_action`, `report_incident` | Signer for write tools. Not needed for read tools. Never commit it. |
| `RPC_MANTLE`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_OPTIMISM`, `RPC_POLYGON` | all tools | Optional RPC overrides; public RPCs are used by default |
| `AUDIT_VAULT_<NETWORK>` | `audit_action`, `get_audit_log`, `verify_proof` | Points a network at an AuditVault v2 deployment. Without it, every network except Base returns an error. |
| `AGENTAUDIT_BUILDER_CODE` | `audit_action`, `report_incident` | Base Builder Code attribution, on Base / Base Sepolia only. Unset or empty: AgentAudit's code `bc_pd681w25`. `false`, `off` or `0` (any case): no suffix. Any other value: your own code. See below. |

The server also loads a `.env` file from the working directory (dotenv). Variables already set in the environment take precedence.

## Tools

### `audit_action` (write, Base)

Anchors one or more agent actions in **one** `commitBatch` transaction on AuditVault v2. Each call commits immediately; nothing is buffered between calls, so a restart cannot lose entries.

- Input: `agent_id`, `entries[]` (`action_type`, `payload`, optional `risk_level` default `HIGH`, optional `timestamp_ms`), optional `agent_address` (defaults to the signer), `compliance_score` (0–100), `network` (default `base`).
- Payloads are SHA-256 hashed (JCS for objects). Raw content never leaves the process. Each entry becomes an Evidence Schema v1 preimage with scope `agent_action:mcp:record_hash:<sha256>`.
- Returns `txHash`, `batchIndex`, `merkle_root`, each entry's `action_ref` + `proof`, and the full evidence bundle. **Keep the bundle**: the batch payload is not stored anywhere else (`contentURI` is `memory://<root>`).
- Errors (never a silent skip): the network has no AuditVault v2, the vault has no code, or the transaction emitted no `LogBatchCommitted` for the root.

### `get_audit_log` (read, Base)

Reads committed batches, either by `tx_hash` or by `agent_address` + `batch_index`. Returns the root, contentURI, event count, compliance score, submitter, timestamp and block.

### `verify_proof` (read, Base)

Checks one entry's inclusion proof with AuditVault v2 `verifyLog`. The leaf is always recomputed from the preimage, never taken from the caller (KI-2). Returns `valid`, the batch `submitter` and per-check results. Pass `expected_submitter` to pin the submitter (see the caveat below).

### `report_incident` (write, 5 networks)

Records a serious incident on IncidentRegistry v2 (related to Art. 73). This is an on-chain record, not a report to any authority. Before sending, it checks the registry has code. After mining, it requires an `IncidentRegistered` event from the registry address; otherwise it returns an error and never reports success. It does not calculate reporting deadlines: they depend on the type of incident, so confirm them with your legal team.

### `get_evidence_report`, `get_risk_score`, `check_conformity` (read)

Read the Phase 7 contracts: ConformityAssessment (related to Art. 43, 44), RiskManagementSystem (Art. 9) and IncidentRegistry (Art. 73). If a contract has no code on the selected network, the tool returns an error naming the network and address.

These tools list on-chain records. They do not determine whether any obligation under the EU AI Act or any other law is satisfied.

`get_compliance_report` is a deprecated alias of `get_evidence_report` and will be removed in the next major version.

## Caveat: ConformityAssessment records are self-declared

Anyone can register a record for an unused agent id and certify it. Every field, including the notified body, is unverified. An active record means only that this on-chain entry is `CERTIFIED` and has not expired; it is not a conformity assessment result.

## Base Builder Code attribution

On **Base mainnet (8453) and Base Sepolia (84532) only**, the write tools (`audit_action`,
`report_incident`) append a [Base Builder Code](https://docs.base.org/base-chain/builder-codes/builder-codes)
suffix (ERC-8021, schema 0) to their transaction calldata. It is on by default with
AgentAudit's code `bc_pd681w25`, so Base can attribute these transactions to AgentAudit.

- **What is appended:** 29 bytes, `0x62635f70643638317732350b0080218021802180218021802180218021`
  (`"bc_pd681w25"`, length `0x0b`, schema `0x00`, then the marker `0x8021` × 8).
- **What stays the same:** the contracts ignore the suffix, so events and state are
  identical, and no evidence changes (`action_ref`, Merkle root, bundle). Only the tx hash differs.
- **The code is public** on-chain. The chain is read from the RPC (`eth_chainId`);
  other chains never get a suffix.
- **Turn it off:** `AGENTAUDIT_BUILDER_CODE=false`. **Use your own code:**
  `AGENTAUDIT_BUILDER_CODE=bc_yourcode` (ERC-8021 rules: 7-bit ASCII, no comma, ≤ 255 bytes;
  an invalid value stops the server at startup).

## Caveat: AuditVault v2 does not authenticate submitters

`commitBatch` on AuditVault v2 has no access control. **Anyone can commit a batch under any agent address.** A batch existing under an agent address therefore does not prove that agent's operator committed it, and batch counts can be inflated by third parties ([THREAT_MODEL KI-1](https://github.com/agentauditAI/AgentAudit/blob/main/docs/THREAT_MODEL.md)).

When you verify, check the batch `submitter`: `get_audit_log` and `verify_proof` both return it, and `verify_proof` takes `expected_submitter` to enforce it. Accept a batch only if the submitter is an address you have authorized for that agent. For full bundles, the `agentaudit-verify` CLI in the repo does the same with `--submitter`.

## License

MIT
