import type { AgentInfo, AuditLogEntry, VaultBatchSummary } from "./chain";
import type { Network } from "./types";

// Evidence report v2 — lists what on-chain evidence was looked for and found.
// It never states whether any legal obligation is satisfied.

export const REPORT_VERSION = 2;

export const REPORT_DISCLAIMER =
  "This report lists on-chain evidence found by the checks below. " +
  "It does not determine whether any obligation under the EU AI Act or any other law is satisfied. " +
  "Not legal advice.";

export type EvidenceStatus = "evidence_found" | "no_evidence" | "not_checked";

export interface EvidenceCheck {
  source: "AgentRegistration" | "AgentAuditBatch" | "AuditVault v2";
  network: Network;
  address: string | null;
  status: EvidenceStatus;
  detail: string;
  data?: Record<string, unknown>;
}

export interface ArticleEvidence {
  article: string;
  status: EvidenceStatus;
  detail?: string;
  checks: EvidenceCheck[];
}

export interface ReportInputs {
  agentId: string;
  network: Network;
  registrationAddress: string;
  agent: AgentInfo;
  /** null = AgentAuditBatch not configured for this network */
  auditBatch: { address: string; logs: AuditLogEntry[] } | null;
  /** null = no agent_address supplied */
  vault: VaultBatchSummary | null;
  vaultAddress: string;
  generatedAt?: Date;
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** evidence_found if any check found evidence; no_evidence if any check ran; else not_checked */
export function aggregate(checks: EvidenceCheck[]): EvidenceStatus {
  if (checks.some((c) => c.status === "evidence_found")) return "evidence_found";
  if (checks.some((c) => c.status === "no_evidence")) return "no_evidence";
  return "not_checked";
}

function registrationCheck(i: ReportInputs): EvidenceCheck {
  const base = { source: "AgentRegistration" as const, network: i.network, address: i.registrationAddress };
  if (!i.agent.registered) {
    return {
      ...base,
      status: "no_evidence",
      detail: `no AgentRegistration record for agent #${i.agentId} on ${i.network}`,
    };
  }
  const revokedNote = i.agent.revoked
    ? "; the registration has been revoked by the operator"
    : "; not revoked";
  return {
    ...base,
    status: "evidence_found",
    detail: `agent #${i.agentId} registered on ${i.network} at ${iso(i.agent.createdAt)}, operator ${i.agent.operator}${revokedNote}`,
  };
}

function auditBatchCheck(i: ReportInputs): EvidenceCheck {
  const envVar = `AUDIT_BATCH_${i.network.toUpperCase()}`;
  if (!i.auditBatch) {
    return {
      source: "AgentAuditBatch",
      network: i.network,
      address: null,
      status: "not_checked",
      detail: `${envVar} not configured; no verified AgentAuditBatch deployment is recorded in deployments/`,
    };
  }
  const { address, logs } = i.auditBatch;
  const base = { source: "AgentAuditBatch" as const, network: i.network, address };
  const caveat = "logAction is permissionless, so the submitter is not verified (AgentAuditBatch)";
  if (logs.length === 0) {
    return { ...base, status: "no_evidence", detail: `0 AuditLogged events for agent #${i.agentId} on ${i.network}; ${caveat}` };
  }
  const last = logs[logs.length - 1];
  return {
    ...base,
    status: "evidence_found",
    detail: `${logs.length} AuditLogged events for agent #${i.agentId} on ${i.network}; ${caveat}`,
    data: {
      event_count: logs.length,
      first_at: iso(logs[0].timestamp),
      last_at: iso(last.timestamp),
      last_block: last.blockNumber ?? null,
      last_tx: last.txHash,
    },
  };
}

function vaultCheck(i: ReportInputs): EvidenceCheck {
  const base = { source: "AuditVault v2" as const, network: "base" as Network, address: i.vaultAddress };
  if (!i.vault) {
    return {
      ...base,
      status: "not_checked",
      detail: "no agent_address supplied; AuditVault v2 is keyed by agent address, not by agent id",
    };
  }
  const { batchCount, agentAddress, lastBatch } = i.vault;
  return {
    ...base,
    status: batchCount > 0 ? "evidence_found" : "no_evidence",
    detail: `${batchCount} batches recorded under the caller-supplied address ${agentAddress}; this address is not linked to agent #${i.agentId} on-chain and the submitter is not verified (AuditVault v2)`,
    data: {
      batch_count: batchCount,
      last_batch_index: lastBatch?.batchIndex ?? null,
      last_block: lastBatch?.blockNumber ?? null,
      last_at: lastBatch ? iso(lastBatch.timestamp) : null,
    },
  };
}

function notChecked(article: string, detail: string): ArticleEvidence {
  return { article, status: "not_checked", detail, checks: [] };
}

export function buildEvidenceReport(i: ReportInputs) {
  const logChecks = [auditBatchCheck(i), vaultCheck(i)];
  const regCheck = registrationCheck(i);

  const evidence: ArticleEvidence[] = [
    { article: "Art. 12", status: aggregate(logChecks), checks: logChecks },
    { article: "Art. 19", status: aggregate(logChecks), checks: logChecks },
    { article: "Art. 26", status: aggregate([regCheck]), checks: [regCheck] },
    notChecked("Art. 13", "no automated check is performed by this API"),
    notChecked("Art. 9", "RiskManagementSystem is not queried by this API"),
    notChecked("Art. 72", "PostMarketMonitor is not deployed"),
  ];

  const a = i.agent;
  return {
    report_version: REPORT_VERSION,
    generated_at: (i.generatedAt ?? new Date()).toISOString(),
    agent_id: i.agentId,
    network: i.network,
    disclaimer: REPORT_DISCLAIMER,
    agent: {
      registered: a.registered,
      name: a.registered ? a.name : null,
      operator: a.registered ? a.operator : null,
      registered_at: a.registered ? iso(a.createdAt) : null,
      // operator self-declared in AgentRegistration; not a legal risk classification
      declared_risk_tier: a.registered ? a.complianceLevel : null,
      revoked: a.registered ? a.revoked : null,
    },
    evidence,
  };
}
