import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { Network } from "./types";

const RPC_URLS: Record<Network, string> = {
  mantle:   process.env.RPC_MANTLE   || "https://rpc.mantle.xyz",
  base:     process.env.RPC_BASE     || "https://mainnet.base.org",
  arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
  polygon:  process.env.RPC_POLYGON  || "https://polygon-bor-rpc.publicnode.com",
};

// Contract addresses are resolved from env vars at call time. The only default is the
// Mantle AgentRegistration (verified on-chain). There is deliberately NO default for
// AgentAuditBatch: no deployment of it is recorded in deployments/, and the address
// previously hardcoded here was malformed (36 hex chars).
const DEFAULT_REGISTRATION: Partial<Record<Network, string>> = {
  mantle: "0x68769980879414e8f264Ac15a87813E2ABaBaD6e",
};

const AUDIT_BATCH_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash) external",
  "function getLogCount(uint256 agentId) external view returns (uint256)",
  "event AuditLogged(uint256 indexed agentId, string actionType, bytes32 payloadHash, uint256 timestamp)",
];

const REGISTRATION_ABI = [
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)",
];

const AUDIT_VAULT_V2_ABI = [
  "function getBatchCount(address agentId) external view returns (uint256)",
  "function getBatch(address agentId, uint256 batchIndex) external view returns (tuple(bytes32 merkleRoot, string contentURI, uint256 timestamp, uint256 blockNumber, uint256 eventCount, address submitter, uint8 complianceScore))",
];

export interface AuditLogEntry {
  agentId: string;
  actionType: string;
  payloadHash: string;
  timestamp: number;
  txHash: string;
  blockNumber: number;
}

export interface AgentInfo {
  /** true only when agentId > 0 and the record has a non-zero createdAt */
  registered: boolean;
  name: string;
  operator: string;
  createdAt: number;
  /** operator self-declared tier ("minimal" | "limited" | "high"); not a legal classification */
  complianceLevel: string;
  spendLimit: string;
  revoked: boolean;
}

export interface VaultBatchSummary {
  vaultAddress: string;
  agentAddress: string;
  batchCount: number;
  /** null when batchCount is 0 */
  lastBatch: { batchIndex: number; blockNumber: number; timestamp: number } | null;
}

/** A network (or one contract on it) has no address configured → 503 */
export class NetworkNotConfiguredError extends Error {
  constructor(network: string, detail?: string) {
    super(detail ?? `Contract addresses not configured for network: ${network}. Set REGISTRATION_${network.toUpperCase()} (and AUDIT_BATCH_${network.toUpperCase()} for per-action logging).`);
    this.name = "NetworkNotConfiguredError";
  }
}

/** A configured address is not a valid EVM address → 503 (server misconfiguration) */
export class ContractConfigError extends Error {
  constructor(envVar: string, value: string) {
    super(`Invalid contract address in ${envVar}: "${value}" is not a valid EVM address.`);
    this.name = "ContractConfigError";
  }
}

function resolveAddress(envVar: string, fallback?: string): string | null {
  const value = process.env[envVar] || fallback || "";
  if (!value) return null;
  if (!ethers.isAddress(value)) throw new ContractConfigError(envVar, value);
  return value;
}

function auditBatchNotConfigured(network: Network): NetworkNotConfiguredError {
  const env = `AUDIT_BATCH_${network.toUpperCase()}`;
  return new NetworkNotConfiguredError(
    network,
    `AgentAuditBatch address not configured for network: ${network}. Set ${env}; no verified AgentAuditBatch deployment is recorded in deployments/.`,
  );
}

export function getChainClient(network: Network) {
  const registrationAddress = resolveAddress(`REGISTRATION_${network.toUpperCase()}`, DEFAULT_REGISTRATION[network]);
  const auditBatchAddress = resolveAddress(`AUDIT_BATCH_${network.toUpperCase()}`);

  if (!registrationAddress) throw new NetworkNotConfiguredError(network);

  const provider = new ethers.JsonRpcProvider(RPC_URLS[network]);

  // Known issue: a key is required even for read-only calls (tracked separately).
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var not set");
  const wallet = new ethers.Wallet(privateKey, provider);

  const registration = new ethers.Contract(registrationAddress, REGISTRATION_ABI, wallet);
  const auditBatch = auditBatchAddress
    ? new ethers.Contract(auditBatchAddress, AUDIT_BATCH_ABI, wallet)
    : null;

  return {
    registrationAddress,
    auditBatchAddress,

    async logAction(agentId: number, actionType: string, payload: string): Promise<string> {
      if (!auditBatch) throw auditBatchNotConfigured(network);
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
      const tx = await auditBatch.logAction(agentId, actionType, payloadHash);
      await tx.wait();
      return tx.hash as string;
    },

    async getAuditTrail(agentId: number): Promise<AuditLogEntry[]> {
      if (!auditBatch) throw auditBatchNotConfigured(network);
      const filter = auditBatch.filters.AuditLogged(agentId);
      const events = await auditBatch.queryFilter(filter);
      return events.map((e: any) => ({
        agentId: e.args.agentId.toString(),
        actionType: e.args.actionType as string,
        payloadHash: e.args.payloadHash as string,
        timestamp: Number(e.args.timestamp),
        txHash: e.transactionHash as string,
        blockNumber: Number(e.blockNumber),
      }));
    },

    async getAgentInfo(agentId: number): Promise<AgentInfo> {
      const agent = await registration.agents(agentId);
      const createdAt = Number(agent[2]);
      return {
        // AgentRegistration.isActive(0) returns true for an empty record, so it is not used.
        registered: agentId > 0 && createdAt > 0,
        name: agent[0] as string,
        operator: agent[1] as string,
        createdAt,
        complianceLevel: agent[3] as string,
        spendLimit: agent[4].toString(),
        revoked: agent[6] as boolean,
      };
    },
  };
}

export type ChainClient = ReturnType<typeof getChainClient>;

/** AuditVault v2 on Base: env AUDIT_VAULT_BASE, else deployments/auditvault-base.json */
export function getBaseVaultAddress(): string {
  const deployed = JSON.parse(
    readFileSync(join(__dirname, "../../deployments/auditvault-base.json"), "utf8"),
  ).contracts.AuditVault as string;
  return resolveAddress("AUDIT_VAULT_BASE", deployed) as string;
}

/** Read-only AuditVault v2 reader on Base (no key needed) */
export function getBaseVaultReader() {
  const vaultAddress = getBaseVaultAddress();
  const provider = new ethers.JsonRpcProvider(RPC_URLS.base);
  const vault = new ethers.Contract(vaultAddress, AUDIT_VAULT_V2_ABI, provider);

  return {
    vaultAddress,
    async getBatchSummary(agentAddress: string): Promise<VaultBatchSummary> {
      const batchCount = Number(await vault.getBatchCount(agentAddress));
      if (batchCount === 0) return { vaultAddress, agentAddress, batchCount, lastBatch: null };
      const last = await vault.getBatch(agentAddress, batchCount - 1);
      return {
        vaultAddress,
        agentAddress,
        batchCount,
        lastBatch: {
          batchIndex: batchCount - 1,
          blockNumber: Number(last.blockNumber),
          timestamp: Number(last.timestamp),
        },
      };
    },
  };
}

export type BaseVaultReader = ReturnType<typeof getBaseVaultReader>;
