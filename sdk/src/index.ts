// AgentAudit AI — TypeScript SDK
// @agentauditai/sdk — a RunLockAI product
// EU AI Act compliance: Articles 9, 11, 12, 13, 14, 19, 26, 50, 72, 73
// Networks: Mantle, Base, Arbitrum One, Optimism, Polygon

import { ethers } from "ethers";
import type { BatchCommitter, CommitBatchParams, CommitBatchResult } from "./batch";

export * from "./batch";

// ─── Network Config ───────────────────────────────────────────────────────────
//
// vaultVersion: 1 = AuditVault v1, 2 = AuditVault v2 (verified bytecode),
// null = a contract that is not AuditVault v2 (no commitBatch). Batch
// anchoring works only where vaultVersion is 2, or with auditVaultAddress.
//
// incidentRegistry: IncidentRegistry v2 (contracts/v2/IncidentRegistry.sol,
// Art. 73) from deployments/phase7-<network>.json — runtime bytecode verified
// against the source on all five networks. Optimism has its own address.

export const NETWORKS = {
  mantle: {
    rpc:        "https://rpc.mantle.xyz",
    chainId:    5000,
    auditVault: "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b",
    vaultVersion: 1,
    incidentRegistry: "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
    explorer:   "https://explorer.mantle.xyz",
    name:       "Mantle Mainnet",
  },
  base: {
    rpc:        "https://mainnet.base.org",
    chainId:    8453,
    auditVault: "0xCeE831070aa9081422f30df5559c125aa47A75DB",
    vaultVersion: 2,
    incidentRegistry: "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
    explorer:   "https://basescan.org",
    name:       "Base Mainnet",
  },
  arbitrum: {
    rpc:        "https://arb1.arbitrum.io/rpc",
    chainId:    42161,
    auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    vaultVersion: null, // not AuditVault v2 — no commitBatch (see README "Supported Networks")
    incidentRegistry: "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
    explorer:   "https://arbiscan.io",
    name:       "Arbitrum One",
  },
  optimism: {
    rpc:        "https://mainnet.optimism.io",
    chainId:    10,
    auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    vaultVersion: null, // not AuditVault v2 — no commitBatch (see README "Supported Networks")
    incidentRegistry: "0x976b03a2417cf7926813605F427ED499fdF61e10",
    explorer:   "https://optimistic.etherscan.io",
    name:       "Optimism Mainnet",
  },
  polygon: {
    rpc:        "https://polygon-rpc.com",
    chainId:    137,
    auditVault: "0x6fC00423Df95a7caf6fFFDD93169b5C01480de02",
    vaultVersion: null, // not AuditVault v2 — no commitBatch (see README "Supported Networks")
    incidentRegistry: "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
    explorer:   "https://polygonscan.com",
    name:       "Polygon Mainnet",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const AUDIT_VAULT_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash, uint8 riskLevel) external returns (uint256 logIndex)",
  "function logActionBatch(uint256 agentId, string[] actionTypes, bytes32[] payloadHashes, uint8[] riskLevels) external returns (uint256[] logIndexes)",
  "function getLogCount(uint256 agentId) external view returns (uint256)",
];

// AuditVault v2 (contracts/v2/AuditVault.sol) — Merkle batch anchoring
const AUDIT_VAULT_V2_ABI = [
  "function commitBatch(address agentId, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore) external",
  "function verifyLog(address agentId, uint256 batchIndex, bytes32 logHash, bytes32[] proof) external view returns (bool)",
  "function getBatchCount(address agentId) external view returns (uint256)",
  "event LogBatchCommitted(address indexed agentId, uint256 indexed batchIndex, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore, uint256 timestamp)",
];

const AGENT_REGISTRATION_ABI = [
  "function registerAgent(string name, string complianceLevel, uint256 spendLimit, address auditVault) external returns (uint256 agentId)",
  "function revokeAgent(uint256 agentId) external",
  "function isActive(uint256 agentId) external view returns (bool)",
  "function getOperatorAgents(address operator) external view returns (uint256[])",
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)",
];

// IncidentRegistry v2 (contracts/v2/IncidentRegistry.sol) — Art. 73
const INCIDENT_REGISTRY_ABI = [
  "function registerIncident(bytes32 agentId, uint8 severity, uint8 harmType, string description, string evidenceHash, uint256 affectedPersons, uint256 occurredAt) external returns (uint256 id)",
  "function markReportedToAuthority(uint256 id, address authority, string authorityRef) external",
  "function isWithinDeadline(uint256 id) external view returns (bool)",
  "function reportingDeadline(uint256 id) external view returns (uint256)",
  "function getAgentIncidents(bytes32 agentId) external view returns (uint256[])",
  "function incidents(uint256) external view returns (uint256 id, bytes32 agentId, uint8 severity, uint8 harmType, uint8 status, string description, string evidenceHash, uint256 affectedPersons, address reportedBy, uint256 occurredAt, uint256 registeredAt, uint256 reportedToAuthorityAt, address authorityAddress, string authorityRef, bool withinDeadline, string rootCauseUri, string correctionUri)",
  "event IncidentRegistered(uint256 indexed id, bytes32 indexed agentId, uint8 severity, uint8 harmType, uint256 occurredAt, uint256 timestamp)",
  "event IncidentReported(uint256 indexed id, address authority, string authorityRef, bool withinDeadline, uint256 timestamp)",
];

// Functions an address must implement to count as IncidentRegistry v2
const INCIDENT_REGISTRY_REQUIRED = ["registerIncident", "markReportedToAuthority", "incidents"] as const;

const POST_MARKET_MONITOR_ABI = [
  "function enroll(address agent, string systemName, string riskCategory, uint256 reviewIntervalDays) external",
  "function recordMetric(address agent, uint8 metricType, string metricName, int256 value, int256 threshold, string context, bytes32 txRef) external",
  "function recordReview(address agent, int256 complianceScore, string notes) external",
  "function isReviewDue(address agent) external view returns (bool due, uint256 overdueBySeconds)",
  "function summaries(address) external view returns (uint256 totalMetrics, uint256 alertsLow, uint256 alertsMedium, uint256 alertsHigh, uint256 alertsCritical, int256 lastComplianceScore, uint256 lastUpdatedAt)",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ComplianceLevel = "minimal" | "limited" | "high";
export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
/** Nature of harm — Art. 73§1 qualifying conditions (IncidentRegistry.HarmType) */
export type HarmType =
  | "DEATH"
  | "SERIOUS_HEALTH_HARM"
  | "SIGNIFICANT_PROPERTY_DAMAGE"
  | "FUNDAMENTAL_RIGHTS_VIOLATION"
  | "OTHER";
export type IncidentStatus = "OPEN" | "REPORTED" | "UNDER_INVESTIGATION" | "RESOLVED" | "CLOSED";
export type MetricType = "ERROR_RATE" | "DRIFT_SCORE" | "LATENCY_MS" | "COMPLIANCE_SCORE" | "CUSTOM";

export interface AgentAuditConfig {
  /** Agent wallet private key */
  privateKey: string;
  /** Target network (default: base) */
  network?: NetworkName;
  /** Override RPC URL */
  rpcUrl?: string;
  /** Override the AuditVault v2 address used by commitBatch / verifyLog */
  auditVaultAddress?: string;
  /** AgentRegistration contract address (Mantle primary registry) */
  registrationAddress?: string;
  /** Override the IncidentRegistry v2 address (Art. 73); defaults per network */
  incidentRegistryAddress?: string;
  /** PostMarketMonitor contract address (Art. 72) */
  postMarketMonitorAddress?: string;
}

export interface LogActionParams {
  agentId: number | string;
  actionType: string;
  payload: string | object;
  riskLevel?: RiskLevel;
}

export interface LogActionResult {
  txHash: string;
  logIndex?: number;
  network: NetworkName;
  explorerUrl: string;
}

export interface RegisterAgentResult {
  agentId: number;
  txHash: string;
  network: string;
}

export interface IncidentResult {
  incidentId: number;
  txHash: string;
  withinDeadline?: boolean;
}

export interface ReportIncidentParams {
  /** Numeric/string agent ID (hashed with keccak256) or a bytes32 hex string (used as-is) */
  agentId: string | number;
  severity: IncidentSeverity;
  description: string;
  /** Nature of harm (Art. 73§1); default "OTHER" */
  harmType?: HarmType;
  /** Number of persons affected (Art. 73§3); default 0 */
  affectedPersons?: number | bigint;
  /** Hash or IPFS CID of evidence; default keccak256(description) */
  evidenceHash?: string;
  /** Unix seconds, must not be in the future; default latest block timestamp */
  occurredAt?: number;
}

/** IncidentRegistry v2 `incidents(id)` record */
export interface Incident {
  id: number;
  agentId: string;
  severity: IncidentSeverity;
  harmType: HarmType;
  status: IncidentStatus;
  description: string;
  evidenceHash: string;
  affectedPersons: bigint;
  reportedBy: string;
  occurredAt: number;
  registeredAt: number;
  reportedToAuthorityAt: number;
  authorityAddress: string;
  authorityRef: string;
  withinDeadline: boolean;
  rootCauseUri: string;
  correctionUri: string;
}

const SEVERITIES: readonly IncidentSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const HARM_TYPES: readonly HarmType[] = [
  "DEATH", "SERIOUS_HEALTH_HARM", "SIGNIFICANT_PROPERTY_DAMAGE", "FUNDAMENTAL_RIGHTS_VIOLATION", "OTHER",
];
const INCIDENT_STATUSES: readonly IncidentStatus[] = ["OPEN", "REPORTED", "UNDER_INVESTIGATION", "RESOLVED", "CLOSED"];

// ─── Main SDK Class ───────────────────────────────────────────────────────────

export class AgentAudit implements BatchCommitter {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private network: typeof NETWORKS[NetworkName];
  private networkName: NetworkName;
  private auditVault: ethers.Contract;
  private _auditVaultV2?: ethers.Contract;

  // Optional Phase 7 contracts
  private _registration?: ethers.Contract;
  private _incidentRegistry?: Promise<ethers.Contract>;
  private _postMarketMonitor?: ethers.Contract;

  private config: AgentAuditConfig;

  constructor(config: AgentAuditConfig) {
    this.config = config;
    this.networkName = config.network ?? "base";
    this.network = NETWORKS[this.networkName];

    const rpc = config.rpcUrl ?? this.network.rpc;
    // cacheTimeout -1: ethers caches identical calls (incl. eth_getTransactionCount)
    // for 250ms by default, which hands back-to-back commits the same nonce.
    this.provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.auditVault = new ethers.Contract(this.network.auditVault, AUDIT_VAULT_ABI, this.wallet);
  }

  // ─── Lazy contract getters ──────────────────────────────────────────────────

  private get registration(): ethers.Contract {
    if (!this._registration) {
      const addr = this.config.registrationAddress
        ?? "0x68769980879414e8f264Ac15a87813E2ABaBaD6e";
      this._registration = new ethers.Contract(addr, AGENT_REGISTRATION_ABI, this.wallet);
    }
    return this._registration;
  }

  private get auditVaultV2(): ethers.Contract {
    if (!this._auditVaultV2) {
      const addr = this.config.auditVaultAddress
        ?? (this.network.vaultVersion === 2 ? this.network.auditVault : undefined);
      if (!addr) {
        const what = this.network.vaultVersion === 1
          ? "is AuditVault v1"
          : "is not AuditVault v2";
        throw new Error(
          `Batch anchoring is not available on ${this.network.name}: the default AuditVault ` +
          `(${this.network.auditVault}) ${what} and has no commitBatch. ` +
          "Pass auditVaultAddress pointing at an AuditVault v2 deployment, or use network \"base\"."
        );
      }
      this._auditVaultV2 = new ethers.Contract(addr, AUDIT_VAULT_V2_ABI, this.wallet);
    }
    return this._auditVaultV2;
  }

  /**
   * The IncidentRegistry v2 contract, after checking once per instance that the
   * address has code implementing the v2 functions. A mismatch is cached (it
   * will not fix itself); an RPC failure is not, so the next call retries.
   */
  private incidentRegistry(): Promise<ethers.Contract> {
    this._incidentRegistry ??= this.verifyIncidentRegistry().catch((err) => {
      if (!err.incidentRegistryMismatch) this._incidentRegistry = undefined;
      throw err;
    });
    return this._incidentRegistry;
  }

  private async verifyIncidentRegistry(): Promise<ethers.Contract> {
    const addr = this.config.incidentRegistryAddress ?? this.network.incidentRegistry;
    const contract = new ethers.Contract(addr, INCIDENT_REGISTRY_ABI, this.wallet);
    const code = (await this.provider.getCode(addr)).toLowerCase();
    // Selectors appear in the dispatcher as PUSH4 (0x63) immediates
    const missing = INCIDENT_REGISTRY_REQUIRED
      .map((name) => contract.interface.getFunction(name)!)
      .filter((fn) => !code.includes("63" + fn.selector.slice(2)))
      .map((fn) => fn.format("sighash"));
    if (code === "0x" || missing.length) {
      const what = code === "0x" ? "has no contract code" : `does not implement ${missing.join(", ")}`;
      const err = new Error(
        `IncidentRegistry v2 is not available on ${this.network.name}: ${addr} ${what}. ` +
        "Pass incidentRegistryAddress pointing at an IncidentRegistry v2 deployment (contracts/v2/IncidentRegistry.sol)."
      );
      Object.assign(err, { incidentRegistryMismatch: true });
      throw err;
    }
    return contract;
  }

  private get postMarketMonitor(): ethers.Contract {
    if (!this.config.postMarketMonitorAddress) {
      throw new Error("postMarketMonitorAddress not configured. Pass it in AgentAuditConfig.");
    }
    if (!this._postMarketMonitor) {
      this._postMarketMonitor = new ethers.Contract(
        this.config.postMarketMonitorAddress,
        POST_MARKET_MONITOR_ABI,
        this.wallet
      );
    }
    return this._postMarketMonitor;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private hashPayload(payload: string | object): string {
    const str = typeof payload === "string" ? payload : JSON.stringify(payload);
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  private riskToUint(risk: RiskLevel = "LOW"): number {
    return { LOW: 0, MEDIUM: 1, HIGH: 2 }[risk];
  }

  private enumIndex<T extends string>(labels: readonly T[], value: T, name: string): number {
    const i = labels.indexOf(value);
    if (i < 0) throw new Error(`Invalid ${name}: ${String(value)}. Use one of ${labels.join(", ")}`);
    return i;
  }

  /** bytes32 hex is used as-is; anything else is keccak256(String(agentId)) */
  private incidentAgentId(agentId: string | number): string {
    const s = String(agentId);
    return /^0x[0-9a-fA-F]{64}$/.test(s) ? s : ethers.id(s);
  }

  private metricTypeToUint(type: MetricType = "COMPLIANCE_SCORE"): number {
    return { ERROR_RATE: 0, DRIFT_SCORE: 1, LATENCY_MS: 2, COMPLIANCE_SCORE: 3, CUSTOM: 4 }[type];
  }

  private explorerTx(txHash: string): string {
    return `${this.network.explorer}/tx/${txHash}`;
  }

  // ─── Core: Audit Logging (Art. 12, 19, 50) ──────────────────────────────────

  /**
   * Log a single agent action on-chain (Art. 12, 19, 50)
   */
  async log(params: LogActionParams): Promise<LogActionResult> {
    const payloadHash = this.hashPayload(params.payload);
    const risk = this.riskToUint(params.riskLevel);
    const agentId = String(params.agentId);

    const tx = await this.auditVault.logAction(agentId, params.actionType, payloadHash, risk);
    await tx.wait();

    return {
      txHash: tx.hash,
      network: this.networkName,
      explorerUrl: this.explorerTx(tx.hash),
    };
  }

  /**
   * Alias for log() — the name the LLM wrappers call in per_action mode
   */
  async logAction(params: LogActionParams): Promise<LogActionResult> {
    return this.log(params);
  }

  /**
   * Log multiple actions in one transaction (gas efficient)
   */
  async logBatch(
    agentId: number | string,
    actions: Array<{ actionType: string; payload: string | object; riskLevel?: RiskLevel }>
  ): Promise<LogActionResult> {
    const actionTypes   = actions.map(a => a.actionType);
    const payloadHashes = actions.map(a => this.hashPayload(a.payload));
    const riskLevels    = actions.map(a => this.riskToUint(a.riskLevel));

    const tx = await this.auditVault.logActionBatch(String(agentId), actionTypes, payloadHashes, riskLevels);
    await tx.wait();

    return {
      txHash: tx.hash,
      network: this.networkName,
      explorerUrl: this.explorerTx(tx.hash),
    };
  }

  /**
   * Get total on-chain log count for an agent
   */
  async getLogCount(agentId: number | string): Promise<number> {
    return Number(await this.auditVault.getLogCount(String(agentId)));
  }

  // ─── Batch Anchoring (AuditVault v2 — Art. 12, 19) ──────────────────────────

  /**
   * Anchor a Merkle root of action_refs (docs/EVIDENCE_SCHEMA.md) in one tx.
   * Usually called by BatchBuffer rather than directly.
   */
  async commitBatch(params: CommitBatchParams): Promise<CommitBatchResult> {
    const vault = this.auditVaultV2;
    const tx = await vault.commitBatch(
      params.agentAddress,
      params.merkleRoot,
      params.contentURI,
      params.eventCount,
      params.complianceScore
    );
    const receipt = await tx.wait();

    let batchIndex: number | null = null;
    for (const log of receipt?.logs ?? []) {
      const parsed = (() => { try { return vault.interface.parseLog(log); } catch { return null; } })();
      if (parsed?.name === "LogBatchCommitted" && parsed.args.merkleRoot === params.merkleRoot) {
        batchIndex = Number(parsed.args.batchIndex);
        break;
      }
    }
    return { txHash: tx.hash, batchIndex };
  }

  /**
   * Throw a descriptive error if this network/config cannot batch-anchor.
   * Wrappers call it at construction so batch mode fails fast instead of on
   * the first flush.
   */
  assertBatchAnchoring(): void {
    void this.auditVaultV2;
  }

  /**
   * Check an inclusion proof against a committed batch (AuditVault v2 verifyLog)
   */
  async verifyLog(agentAddress: string, batchIndex: number, leaf: string, proof: string[]): Promise<boolean> {
    return this.auditVaultV2.verifyLog(agentAddress, batchIndex, leaf, proof);
  }

  // ─── Agent Registration (Art. 13, 26 — KYA Standard) ─────────────────────

  /**
   * Register a new AI agent on-chain (KYA standard, Art. 13, 26)
   */
  async registerAgent(params: {
    name: string;
    complianceLevel?: ComplianceLevel;
    spendLimit?: bigint;
    auditVault?: string;
  }): Promise<RegisterAgentResult> {
    const tx = await this.registration.registerAgent(
      params.name,
      params.complianceLevel ?? "limited",
      params.spendLimit ?? ethers.parseEther("100"),
      params.auditVault ?? this.network.auditVault
    );
    await tx.wait();

    // Get agent ID from event or return 0 (caller can query separately)
    return { agentId: 0, txHash: tx.hash, network: this.network.name };
  }

  /**
   * Revoke an agent
   */
  async revokeAgent(agentId: number): Promise<{ txHash: string }> {
    const tx = await this.registration.revokeAgent(agentId);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Check if agent is active
   */
  async isActive(agentId: number): Promise<boolean> {
    return this.registration.isActive(agentId);
  }

  /**
   * Get all agent IDs for the current wallet
   */
  async getMyAgents(): Promise<number[]> {
    const ids = await this.registration.getOperatorAgents(this.wallet.address);
    return ids.map(Number);
  }

  // ─── Incident Reporting (Art. 73) ─────────────────────────────────────────

  /**
   * Register an incident on-chain (Art. 73)
   * The registry enforces the 15/10/2 day reporting timelines (Art. 73§2)
   */
  async reportIncident(params: ReportIncidentParams): Promise<IncidentResult> {
    const severity = this.enumIndex(SEVERITIES, params.severity, "severity");
    const harmType = this.enumIndex(HARM_TYPES, params.harmType ?? "OTHER", "harmType");
    const affectedPersons = BigInt(params.affectedPersons ?? 0);
    if (affectedPersons < 0n) throw new Error(`Invalid affectedPersons: ${affectedPersons}`);

    const registry = await this.incidentRegistry();
    const evidenceHash = params.evidenceHash ?? this.hashPayload(params.description);
    // Block time, not Date.now(): the registry rejects occurredAt > block.timestamp
    const occurredAt = params.occurredAt ?? (await this.provider.getBlock("latest"))!.timestamp;

    const tx = await registry.registerIncident(
      this.incidentAgentId(params.agentId),
      severity,
      harmType,
      params.description,
      evidenceHash,
      affectedPersons,
      occurredAt
    );
    const receipt = await tx.wait();

    let incidentId = 0;
    for (const log of receipt?.logs ?? []) {
      const parsed = (() => { try { return registry.interface.parseLog(log); } catch { return null; } })();
      if (parsed?.name === "IncidentRegistered") {
        incidentId = Number(parsed.args.id);
        break;
      }
    }
    return { incidentId, txHash: tx.hash };
  }

  /**
   * Mark an incident as reported to the national market surveillance authority
   * (Art. 73§2). Only the original reporter or the registry deployer may call it.
   * @param params.authority    Address (or identifier) of the notified authority
   * @param params.authorityRef Authority-issued case reference
   */
  async markReportedToAuthority(
    incidentId: number,
    params: { authority: string; authorityRef: string }
  ): Promise<{ txHash: string; withinDeadline: boolean }> {
    const registry = await this.incidentRegistry();
    const tx = await registry.markReportedToAuthority(
      incidentId,
      ethers.getAddress(params.authority),
      params.authorityRef
    );
    const receipt = await tx.wait();

    let withinDeadline = false;
    for (const log of receipt?.logs ?? []) {
      const parsed = (() => { try { return registry.interface.parseLog(log); } catch { return null; } })();
      if (parsed?.name === "IncidentReported") {
        withinDeadline = parsed.args.withinDeadline;
        break;
      }
    }
    return { txHash: tx.hash, withinDeadline };
  }

  /**
   * Read an incident record (IncidentRegistry v2 `incidents(id)`)
   */
  async getIncident(incidentId: number): Promise<Incident> {
    const r = await (await this.incidentRegistry()).incidents(incidentId);
    if (r.id === 0n) throw new Error(`Incident ${incidentId} not found`);
    return {
      id: Number(r.id),
      agentId: r.agentId,
      severity: SEVERITIES[Number(r.severity)],
      harmType: HARM_TYPES[Number(r.harmType)],
      status: INCIDENT_STATUSES[Number(r.status)],
      description: r.description,
      evidenceHash: r.evidenceHash,
      affectedPersons: r.affectedPersons,
      reportedBy: r.reportedBy,
      occurredAt: Number(r.occurredAt),
      registeredAt: Number(r.registeredAt),
      reportedToAuthorityAt: Number(r.reportedToAuthorityAt),
      authorityAddress: r.authorityAddress,
      authorityRef: r.authorityRef,
      withinDeadline: r.withinDeadline,
      rootCauseUri: r.rootCauseUri,
      correctionUri: r.correctionUri,
    };
  }

  /**
   * Incident IDs registered for an agent (same agentId rules as reportIncident)
   */
  async getAgentIncidents(agentId: string | number): Promise<number[]> {
    const ids = await (await this.incidentRegistry()).getAgentIncidents(this.incidentAgentId(agentId));
    return ids.map(Number);
  }

  /**
   * Whether an incident is still within its Art. 73§2 reporting deadline
   */
  async isWithinDeadline(incidentId: number): Promise<boolean> {
    return (await this.incidentRegistry()).isWithinDeadline(incidentId);
  }

  // ─── Post-Market Monitoring (Art. 72) ─────────────────────────────────────

  /**
   * Enroll an agent in post-market monitoring (Art. 72)
   */
  async enrollMonitoring(params: {
    agentAddress: string;
    systemName: string;
    riskCategory: string;
    reviewIntervalDays: number;
  }): Promise<{ txHash: string }> {
    const tx = await this.postMarketMonitor.enroll(
      params.agentAddress,
      params.systemName,
      params.riskCategory,
      params.reviewIntervalDays
    );
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Record a performance metric (Art. 72)
   */
  async recordMetric(params: {
    agentAddress: string;
    metricType: MetricType;
    metricName: string;
    value: number;
    threshold: number;
    context?: string;
    txRef?: string;
  }): Promise<{ txHash: string }> {
    const tx = await this.postMarketMonitor.recordMetric(
      params.agentAddress,
      this.metricTypeToUint(params.metricType),
      params.metricName,
      params.value,
      params.threshold,
      params.context ?? "sdk",
      params.txRef ? ethers.encodeBytes32String(params.txRef.slice(0, 31)) : ethers.ZeroHash
    );
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Record periodic compliance review (Art. 72)
   * @param complianceScore 0-10000 (e.g. 9500 = 95.00%)
   */
  async recordReview(params: {
    agentAddress: string;
    complianceScore: number;
    notes: string;
  }): Promise<{ txHash: string }> {
    const tx = await this.postMarketMonitor.recordReview(
      params.agentAddress,
      params.complianceScore,
      params.notes
    );
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Check if agent is overdue for review
   */
  async isReviewDue(agentAddress: string): Promise<{ due: boolean; overdueBySeconds: number }> {
    const [due, overdue] = await this.postMarketMonitor.isReviewDue(agentAddress);
    return { due, overdueBySeconds: Number(overdue) };
  }

  // ─── Utils ──────────────────────────────────────────────────────────────────

  /**
   * Get current network info
   */
  getNetworkInfo() {
    return { name: this.networkName, ...this.network };
  }

  /**
   * Get connected wallet address
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Hash any payload for on-chain storage
   */
  hash(payload: string | object): string {
    return this.hashPayload(payload);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create AgentAudit from environment variables
 */
export function createAgentAudit(network: NetworkName = "base"): AgentAudit {
  // AGENT_AUDIT_PRIVATE_KEY: deprecated name from the 1.0.x README, still accepted
  const privateKey = process.env.AUDIT_PRIVATE_KEY ?? process.env.AGENT_AUDIT_PRIVATE_KEY;
  if (!privateKey) throw new Error("AUDIT_PRIVATE_KEY env var required");

  return new AgentAudit({
    privateKey,
    network,
    incidentRegistryAddress: process.env.AUDIT_INCIDENT_REGISTRY || undefined,
    postMarketMonitorAddress: process.env.AUDIT_MONITOR_ADDRESS,
  });
}

export default AgentAudit;

// ─── Usage Examples ───────────────────────────────────────────────────────────
//
// import AgentAudit, { createAgentAudit } from "@agentauditai/sdk";
//
// // Option 1: from env vars
// const audit = createAgentAudit("base");
//
// // Option 2: explicit config
// const audit = new AgentAudit({
//   privateKey: process.env.AUDIT_PRIVATE_KEY!,
//   network: "base",
// });
//
// // Log an action (Art. 12) — 2 lines to compliance
// const result = await audit.log({
//   agentId: 1,
//   actionType: "TRANSFER_APPROVED",
//   payload: { amount: "100 USDC", recipient: "0x..." },
//   riskLevel: "HIGH",
// });
// console.log(result.explorerUrl); // on-chain proof ✅
//
// // Batch log (gas efficient)
// await audit.logBatch(1, [
//   { actionType: "POLICY_CHECK", payload: "...", riskLevel: "LOW" },
//   { actionType: "TRANSFER",     payload: "...", riskLevel: "HIGH" },
// ]);
//
// // Report incident (Art. 73)
// const incident = await audit.reportIncident({
//   agentId: 1,
//   severity: "HIGH",
//   harmType: "SIGNIFICANT_PROPERTY_DAMAGE",
//   affectedPersons: 12,
//   description: "Unexpected behavior detected in financial agent",
// });
// await audit.markReportedToAuthority(incident.incidentId, {
//   authority: "0x...",          // notified market surveillance authority
//   authorityRef: "MSA-2026-0042",
// });
//
// // Record monitoring metric (Art. 72)
// await audit.recordMetric({
//   agentAddress: "0x...",
//   metricType: "COMPLIANCE_SCORE",
//   metricName: "weekly_compliance",
//   value: 9500,     // 95.00%
//   threshold: 8000, // 80.00% minimum
// });
