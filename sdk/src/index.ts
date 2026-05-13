// AgentAudit AI — TypeScript SDK
// @agentauditai/sdk — a RunLockAI product
// EU AI Act compliance: Articles 9, 11, 12, 13, 14, 19, 26, 50, 72, 73
// Networks: Mantle, Base, Arbitrum One, Optimism, Polygon

import { ethers } from "ethers";

// ─── Network Config ───────────────────────────────────────────────────────────

export const NETWORKS = {
  mantle: {
    rpc:        "https://rpc.mantle.xyz",
    chainId:    5000,
    auditVault: "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b",
    explorer:   "https://explorer.mantle.xyz",
    name:       "Mantle Mainnet",
  },
  base: {
    rpc:        "https://mainnet.base.org",
    chainId:    8453,
    auditVault: "0x556C4275EE68869C6874C343d0Cb7Fc3C8910873",
    explorer:   "https://basescan.org",
    name:       "Base Mainnet",
  },
  arbitrum: {
    rpc:        "https://arb1.arbitrum.io/rpc",
    chainId:    42161,
    auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    explorer:   "https://arbiscan.io",
    name:       "Arbitrum One",
  },
  optimism: {
    rpc:        "https://mainnet.optimism.io",
    chainId:    10,
    auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    explorer:   "https://optimistic.etherscan.io",
    name:       "Optimism Mainnet",
  },
  polygon: {
    rpc:        "https://polygon-rpc.com",
    chainId:    137,
    auditVault: "0x6fC00423Df95a7caf6fFFDD93169b5C01480de02",
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

const AGENT_REGISTRATION_ABI = [
  "function registerAgent(string name, string complianceLevel, uint256 spendLimit, address auditVault) external returns (uint256 agentId)",
  "function revokeAgent(uint256 agentId) external",
  "function isActive(uint256 agentId) external view returns (bool)",
  "function getOperatorAgents(address operator) external view returns (uint256[])",
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)",
];

const INCIDENT_REGISTRY_ABI = [
  "function registerIncident(bytes32 agentId, uint8 severity, string description, string evidenceHash, uint256 occurredAt) external returns (uint256 id)",
  "function markReportedToAuthority(uint256 id) external",
  "function isWithinDeadline(uint256 id) external view returns (bool)",
  "function incidents(uint256) external view returns (uint256 id, bytes32 agentId, uint8 severity, uint8 status, string description, string evidenceHash, address reportedBy, uint256 occurredAt, uint256 registeredAt, uint256 reportedToAuthorityAt, bool withinDeadline)",
];

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
export type MetricType = "ERROR_RATE" | "DRIFT_SCORE" | "LATENCY_MS" | "COMPLIANCE_SCORE" | "CUSTOM";

export interface AgentAuditConfig {
  /** Agent wallet private key */
  privateKey: string;
  /** Target network (default: base) */
  network?: NetworkName;
  /** Override RPC URL */
  rpcUrl?: string;
  /** AgentRegistration contract address (Mantle primary registry) */
  registrationAddress?: string;
  /** IncidentRegistry contract address (Art. 73) */
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

// ─── Main SDK Class ───────────────────────────────────────────────────────────

export class AgentAudit {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private network: typeof NETWORKS[NetworkName];
  private networkName: NetworkName;
  private auditVault: ethers.Contract;

  // Optional Phase 7 contracts
  private _registration?: ethers.Contract;
  private _incidentRegistry?: ethers.Contract;
  private _postMarketMonitor?: ethers.Contract;

  private config: AgentAuditConfig;

  constructor(config: AgentAuditConfig) {
    this.config = config;
    this.networkName = config.network ?? "base";
    this.network = NETWORKS[this.networkName];

    const rpc = config.rpcUrl ?? this.network.rpc;
    this.provider = new ethers.JsonRpcProvider(rpc);
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

  private get incidentRegistry(): ethers.Contract {
    if (!this.config.incidentRegistryAddress) {
      throw new Error("incidentRegistryAddress not configured. Pass it in AgentAuditConfig.");
    }
    if (!this._incidentRegistry) {
      this._incidentRegistry = new ethers.Contract(
        this.config.incidentRegistryAddress,
        INCIDENT_REGISTRY_ABI,
        this.wallet
      );
    }
    return this._incidentRegistry;
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

  private severityToUint(severity: IncidentSeverity = "MEDIUM"): number {
    return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[severity];
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
   * Enforces 15/10/2 day reporting timelines automatically
   */
  async reportIncident(params: {
    agentId: string | number;
    severity: IncidentSeverity;
    description: string;
    evidenceHash?: string;
    occurredAt?: number;
  }): Promise<IncidentResult> {
    const agentIdBytes = ethers.id(String(params.agentId));
    const evidenceHash = params.evidenceHash ?? this.hashPayload(params.description);
    const occurredAt   = params.occurredAt   ?? Math.floor(Date.now() / 1000);

    const tx = await this.incidentRegistry.registerIncident(
      agentIdBytes,
      this.severityToUint(params.severity),
      params.description,
      evidenceHash,
      occurredAt
    );
    const receipt = await tx.wait();

    return { incidentId: 0, txHash: tx.hash };
  }

  /**
   * Mark incident as reported to authority (Art. 73 — starts deadline clock)
   */
  async markReportedToAuthority(incidentId: number): Promise<{ txHash: string; withinDeadline: boolean }> {
    const withinDeadline = await this.incidentRegistry.isWithinDeadline(incidentId);
    const tx = await this.incidentRegistry.markReportedToAuthority(incidentId);
    await tx.wait();
    return { txHash: tx.hash, withinDeadline };
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
  const privateKey = process.env.AUDIT_PRIVATE_KEY;
  if (!privateKey) throw new Error("AUDIT_PRIVATE_KEY env var required");

  return new AgentAudit({
    privateKey,
    network,
    incidentRegistryAddress: process.env.AUDIT_INCIDENT_REGISTRY,
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
//   description: "Unexpected behavior detected in financial agent",
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
