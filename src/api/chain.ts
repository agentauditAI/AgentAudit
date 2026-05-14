import { ethers } from "ethers";
import { Network } from "./types";

const RPC_URLS: Record<Network, string> = {
  mantle:   process.env.RPC_MANTLE   || "https://rpc.mantle.xyz",
  base:     process.env.RPC_BASE     || "https://mainnet.base.org",
  arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
  polygon:  process.env.RPC_POLYGON  || "https://polygon-rpc.com",
};

// Contract addresses per network — set via env vars, fallback to known Mantle mainnet values
const AUDIT_BATCH_ADDRESSES: Record<Network, string> = {
  mantle:   process.env.AUDIT_BATCH_MANTLE   || "0xAF9ccA0C3D79900576557329F57824A0e277",
  base:     process.env.AUDIT_BATCH_BASE     || "",
  arbitrum: process.env.AUDIT_BATCH_ARBITRUM || "",
  optimism: process.env.AUDIT_BATCH_OPTIMISM || "",
  polygon:  process.env.AUDIT_BATCH_POLYGON  || "",
};

const REGISTRATION_ADDRESSES: Record<Network, string> = {
  mantle:   process.env.REGISTRATION_MANTLE   || "0x68769980879414e8f264Ac15a87813E2ABaBaD6e",
  base:     process.env.REGISTRATION_BASE     || "",
  arbitrum: process.env.REGISTRATION_ARBITRUM || "",
  optimism: process.env.REGISTRATION_OPTIMISM || "",
  polygon:  process.env.REGISTRATION_POLYGON  || "",
};

const AUDIT_BATCH_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash) external",
  "function getLogCount(uint256 agentId) external view returns (uint256)",
  "event AuditLogged(uint256 indexed agentId, string actionType, bytes32 payloadHash, uint256 timestamp)",
];

const REGISTRATION_ABI = [
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)",
  "function isActive(uint256 agentId) external view returns (bool)",
];

export interface AuditLogEntry {
  agentId: string;
  actionType: string;
  payloadHash: string;
  timestamp: number;
  txHash: string;
}

export interface AgentInfo {
  name: string;
  operator: string;
  createdAt: number;
  complianceLevel: string;
  spendLimit: string;
  active: boolean;
  logCount: number;
}

export class NetworkNotConfiguredError extends Error {
  constructor(network: string) {
    super(`Contract addresses not configured for network: ${network}. Set AUDIT_BATCH_${network.toUpperCase()} and REGISTRATION_${network.toUpperCase()} env vars.`);
    this.name = "NetworkNotConfiguredError";
  }
}

export function getChainClient(network: Network) {
  const auditBatchAddress = AUDIT_BATCH_ADDRESSES[network];
  const registrationAddress = REGISTRATION_ADDRESSES[network];

  if (!auditBatchAddress || !registrationAddress) {
    throw new NetworkNotConfiguredError(network);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var not set");

  const provider = new ethers.JsonRpcProvider(RPC_URLS[network]);
  const wallet = new ethers.Wallet(privateKey, provider);
  const auditBatch = new ethers.Contract(auditBatchAddress, AUDIT_BATCH_ABI, wallet);
  const registration = new ethers.Contract(registrationAddress, REGISTRATION_ABI, wallet);

  return {
    async logAction(agentId: number, actionType: string, payload: string): Promise<string> {
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
      const tx = await auditBatch.logAction(agentId, actionType, payloadHash);
      await tx.wait();
      return tx.hash as string;
    },

    async getAuditTrail(agentId: number): Promise<AuditLogEntry[]> {
      const filter = auditBatch.filters.AuditLogged(agentId);
      const events = await auditBatch.queryFilter(filter);
      return events.map((e: any) => ({
        agentId: e.args.agentId.toString(),
        actionType: e.args.actionType as string,
        payloadHash: e.args.payloadHash as string,
        timestamp: Number(e.args.timestamp),
        txHash: e.transactionHash as string,
      }));
    },

    async getAgentInfo(agentId: number): Promise<AgentInfo> {
      const [agent, active, logCount] = await Promise.all([
        registration.agents(agentId),
        registration.isActive(agentId),
        auditBatch.getLogCount(agentId),
      ]);
      return {
        name: agent[0] as string,
        operator: agent[1] as string,
        createdAt: Number(agent[2]),
        complianceLevel: agent[3] as string,
        spendLimit: agent[4].toString(),
        active: active as boolean,
        logCount: Number(logCount),
      };
    },
  };
}

export type ChainClient = ReturnType<typeof getChainClient>;
