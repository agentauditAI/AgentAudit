import { ethers } from 'ethers';

// ─────────────────────────────────────────────────────────
// ABI (minimal — only what the SDK needs)
// ─────────────────────────────────────────────────────────

const AUDIT_VAULT_ABI = [
  'function logAction(string calldata action, string calldata metadata) external returns (uint256)',
  'function getLog(uint256 index) external view returns (tuple(address agent, string action, string metadata, uint256 timestamp, uint256 blockNumber))',
  'function totalLogs() external view returns (uint256)',
  'function getAgentLogs(address agent) external view returns (tuple(address agent, string action, string metadata, uint256 timestamp, uint256 blockNumber)[])',
  'event ActionLogged(uint256 indexed logIndex, address indexed agent, string action, uint256 timestamp)',
];

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface AgentAuditConfig {
  contractAddress: string;
  rpcUrl: string;
  privateKey: string;
}

export interface LogEntry {
  agent: string;
  action: string;
  metadata: string;
  timestamp: number;
  blockNumber: number;
}

export interface LogActionParams {
  action: string;
  metadata: Record<string, unknown> | string;
}

export interface LogReceipt {
  logIndex: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────
// SDK
// ─────────────────────────────────────────────────────────

export class AgentAudit {
  private contract: ethers.Contract;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(config: AgentAuditConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.contract = new ethers.Contract(
      config.contractAddress,
      AUDIT_VAULT_ABI,
      this.wallet
    );
  }

  /**
   * Log an AI agent action on-chain.
   * Returns a receipt with the log index and tx hash.
   */
  async log(params: LogActionParams): Promise<LogReceipt> {
    const metadataStr =
      typeof params.metadata === 'string'
        ? params.metadata
        : JSON.stringify(params.metadata);

    const tx = await this.contract.logAction(params.action, metadataStr);
    const receipt = await tx.wait();

    // Parse log index from emitted event
    const iface = new ethers.Interface(AUDIT_VAULT_ABI);
    let logIndex = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === 'ActionLogged') {
          logIndex = Number(parsed.args.logIndex);
          break;
        }
      } catch {
        // skip non-matching logs
      }
    }

    return {
      logIndex,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Retrieve a single log entry by its global index.
   */
  async getLog(index: number): Promise<LogEntry> {
    const entry = await this.contract.getLog(index);
    return this._formatEntry(entry);
  }

  /**
   * Total number of log entries ever written to the contract.
   */
  async totalLogs(): Promise<number> {
    const total = await this.contract.totalLogs();
    return Number(total);
  }

  /**
   * All log entries written by a specific agent address.
   */
  async getAgentLogs(agentAddress: string): Promise<LogEntry[]> {
    const entries = await this.contract.getAgentLogs(agentAddress);
    return entries.map(this._formatEntry);
  }

  /**
   * Address of the connected wallet (operator).
   */
  get operatorAddress(): string {
    return this.wallet.address;
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  private _formatEntry(raw: {
    agent: string;
    action: string;
    metadata: string;
    timestamp: bigint;
    blockNumber: bigint;
  }): LogEntry {
    return {
      agent: raw.agent,
      action: raw.action,
      metadata: raw.metadata,
      timestamp: Number(raw.timestamp),
      blockNumber: Number(raw.blockNumber),
    };
  }
}
