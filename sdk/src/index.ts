import { ethers } from "ethers";

// Contract addresses — Mantle Mainnet
export const CONTRACTS = {
  AUDIT_VAULT_V1: "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b",
  AGENT_REGISTRATION: "0x68769980879414e8f264Ac15a87813E2ABaBaD6e",
  AGENT_AUDIT_BATCH: "0xAF9ccA0C3D79900576557329F57824A0e277",
};

export const MANTLE_RPC = "https://rpc.mantle.xyz";

const REGISTRATION_ABI = [
  "function registerAgent(string name, string complianceLevel, uint256 spendLimit, address auditVault) external returns (uint256 agentId)",
  "function revokeAgent(uint256 agentId) external",
  "function isActive(uint256 agentId) external view returns (bool)",
  "function getOperatorAgents(address operator) external view returns (uint256[])",
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)"
];

const AUDIT_BATCH_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash) external",
  "function logActionBatch(uint256 agentId, string[] actionTypes, bytes32[] payloadHashes) external",
  "function getLogCount(uint256 agentId) external view returns (uint256)"
];

export interface AgentAuditConfig {
  privateKey: string;
  rpcUrl?: string;
}

export interface LogActionParams {
  agentId: number;
  actionType: string;
  payload: string;
}

export class AgentAudit {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private registration: ethers.Contract;
  private auditBatch: ethers.Contract;

  constructor(config: AgentAuditConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl || MANTLE_RPC);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.registration = new ethers.Contract(CONTRACTS.AGENT_REGISTRATION, REGISTRATION_ABI, this.wallet);
    this.auditBatch = new ethers.Contract(CONTRACTS.AGENT_AUDIT_BATCH, AUDIT_BATCH_ABI, this.wallet);
  }

  /**
   * Register a new AI agent on-chain (KYA standard)
   */
  async registerAgent(
    name: string,
    complianceLevel: "minimal" | "limited" | "high" = "limited",
    spendLimit: bigint = ethers.parseEther("100"),
    auditVault: string = CONTRACTS.AUDIT_VAULT_V1
  ): Promise<{ agentId: number; txHash: string }> {
    const tx = await this.registration.registerAgent(name, complianceLevel, spendLimit, auditVault);
    const receipt = await tx.wait();
    const agentId = Number(await this.registration.agentCount());
    return { agentId, txHash: tx.hash };
  }

  /**
   * Log a single agent action
   */
  async logAction({ agentId, actionType, payload }: LogActionParams): Promise<{ txHash: string }> {
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
    const tx = await this.auditBatch.logAction(agentId, actionType, payloadHash);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Log multiple actions in one transaction (gas efficient)
   */
  async logActionBatch(
    agentId: number,
    actions: { actionType: string; payload: string }[]
  ): Promise<{ txHash: string }> {
    const actionTypes = actions.map((a) => a.actionType);
    const payloadHashes = actions.map((a) => ethers.keccak256(ethers.toUtf8Bytes(a.payload)));
    const tx = await this.auditBatch.logActionBatch(agentId, actionTypes, payloadHashes);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Get total log count for an agent
   */
  async getLogCount(agentId: number): Promise<number> {
    return Number(await this.auditBatch.getLogCount(agentId));
  }

  /**
   * Check if agent is active
   */
  async isActive(agentId: number): Promise<boolean> {
    return this.registration.isActive(agentId);
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
   * Get all agent IDs for the current operator
   */
  async getMyAgents(): Promise<number[]> {
    const ids = await this.registration.getOperatorAgents(this.wallet.address);
    return ids.map(Number);
  }
}

export default AgentAudit;