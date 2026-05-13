// AgentAudit AI — LangChain Callback Handler
// EU AI Act compliance logging for LangChain agents
// Articles: 9, 12, 13, 19, 50, 72, 73
// Networks: Mantle, Base, Arbitrum One, Optimism, Polygon

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { ethers } from "ethers";

// ─── Network Config ───────────────────────────────────────────────────────────

const NETWORKS = {
  mantle:   { rpc: "https://rpc.mantle.xyz",          auditVault: "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b" },
  base:     { rpc: "https://mainnet.base.org",         auditVault: "0x556C4275EE68869C6874C343d0Cb7Fc3C8910873" },
  arbitrum: { rpc: "https://arb1.arbitrum.io/rpc",     auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C" },
  optimism: { rpc: "https://mainnet.optimism.io",      auditVault: "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C" },
  polygon:  { rpc: "https://polygon-rpc.com",          auditVault: "0x6fC00423Df95a7caf6fFFDD93169b5C01480de02" },
};

const AUDIT_VAULT_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash, uint8 riskLevel) external returns (uint256 logIndex)",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentAuditHandlerConfig {
  /** Agent wallet private key */
  privateKey: string;
  /** Registered agent ID on-chain */
  agentId: number | string;
  /** Network to log to (default: base) */
  network?: keyof typeof NETWORKS;
  /** Default risk level: 0=LOW, 1=MEDIUM, 2=HIGH */
  defaultRiskLevel?: 0 | 1 | 2;
  /** Log LLM calls (default: true) */
  logLLMCalls?: boolean;
  /** Log tool use (default: true) */
  logToolUse?: boolean;
  /** Log chain steps (default: true) */
  logChainSteps?: boolean;
  /** Log agent actions (default: true) */
  logAgentActions?: boolean;
  /** Silent mode — no console output */
  silent?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class AgentAuditHandler extends BaseCallbackHandler {
  name = "AgentAuditHandler";

  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private agentId: string;
  private config: Required<AgentAuditHandlerConfig>;
  private network: string;

  // Batch queue for gas efficiency
  private queue: Array<{ actionType: string; payloadHash: string; riskLevel: number }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor(config: AgentAuditHandlerConfig) {
    super();

    this.config = {
      network:          "base",
      defaultRiskLevel: 0,
      logLLMCalls:      true,
      logToolUse:       true,
      logChainSteps:    true,
      logAgentActions:  true,
      silent:           false,
      ...config,
    };

    const net = NETWORKS[this.config.network];
    if (!net) throw new Error(`Unknown network: ${this.config.network}`);

    this.network = this.config.network;
    const provider = new ethers.JsonRpcProvider(net.rpc);
    this.wallet = new ethers.Wallet(this.config.privateKey, provider);
    this.contract = new ethers.Contract(net.auditVault, AUDIT_VAULT_ABI, this.wallet);
    this.agentId = String(this.config.agentId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private hash(data: unknown): string {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  private log(msg: string): void {
    if (!this.config.silent) console.log(`[AgentAudit] ${msg}`);
  }

  private async writeLog(actionType: string, payload: unknown, riskLevel?: number): Promise<void> {
    try {
      const payloadHash = this.hash(payload);
      const risk = riskLevel ?? this.config.defaultRiskLevel;
      const tx = await this.contract.logAction(this.agentId, actionType, payloadHash, risk);
      this.log(`${actionType} logged | TX: ${tx.hash} | Network: ${this.network}`);
      // Don't await tx.wait() — fire and forget for performance
    } catch (err: any) {
      this.log(`Error logging ${actionType}: ${err.message}`);
    }
  }

  // ─── LLM Events (Art. 50 — AI content transparency) ─────────────────────

  async handleLLMStart(llm: any, prompts: string[]): Promise<void> {
    if (!this.config.logLLMCalls) return;
    await this.writeLog("LLM_START", {
      model: llm.modelName || llm.model || "unknown",
      promptCount: prompts.length,
      promptPreview: prompts[0]?.slice(0, 100),
    });
  }

  async handleLLMEnd(output: any): Promise<void> {
    if (!this.config.logLLMCalls) return;
    await this.writeLog("LLM_END", {
      generations: output.generations?.length,
      tokenUsage: output.llmOutput?.tokenUsage,
    });
  }

  async handleLLMError(err: Error): Promise<void> {
    await this.writeLog("LLM_ERROR", { error: err.message }, 2); // HIGH risk
  }

  // ─── Chain Events (Art. 12 — record keeping) ─────────────────────────────

  async handleChainStart(chain: any, inputs: any): Promise<void> {
    if (!this.config.logChainSteps) return;
    await this.writeLog("CHAIN_START", {
      chainType: chain.id?.[chain.id.length - 1] || "unknown",
      inputKeys: Object.keys(inputs || {}),
    });
  }

  async handleChainEnd(outputs: any): Promise<void> {
    if (!this.config.logChainSteps) return;
    await this.writeLog("CHAIN_END", {
      outputKeys: Object.keys(outputs || {}),
    });
  }

  async handleChainError(err: Error): Promise<void> {
    await this.writeLog("CHAIN_ERROR", { error: err.message }, 2);
  }

  // ─── Tool Events (Art. 9 — risk management) ──────────────────────────────

  async handleToolStart(tool: any, input: string): Promise<void> {
    if (!this.config.logToolUse) return;
    await this.writeLog("TOOL_START", {
      tool: tool.id?.[tool.id.length - 1] || "unknown",
      inputPreview: input?.slice(0, 100),
    });
  }

  async handleToolEnd(output: string): Promise<void> {
    if (!this.config.logToolUse) return;
    await this.writeLog("TOOL_END", {
      outputPreview: output?.slice(0, 100),
    });
  }

  async handleToolError(err: Error): Promise<void> {
    await this.writeLog("TOOL_ERROR", { error: err.message }, 2);
  }

  // ─── Agent Events (Art. 14 — human oversight) ────────────────────────────

  async handleAgentAction(action: any): Promise<void> {
    if (!this.config.logAgentActions) return;
    await this.writeLog("AGENT_ACTION", {
      tool: action.tool,
      toolInput: typeof action.toolInput === "string"
        ? action.toolInput.slice(0, 100)
        : action.toolInput,
      log: action.log?.slice(0, 100),
    });
  }

  async handleAgentEnd(action: any): Promise<void> {
    if (!this.config.logAgentActions) return;
    await this.writeLog("AGENT_END", {
      returnValues: action.returnValues,
    });
  }

  // ─── Text Events ─────────────────────────────────────────────────────────

  async handleText(text: string): Promise<void> {
    // Only log significant text outputs
    if (text.length > 50) {
      await this.writeLog("TEXT_OUTPUT", { preview: text.slice(0, 100) });
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an AgentAuditHandler from environment variables
 *
 * Required env vars:
 *   AUDIT_PRIVATE_KEY   — agent wallet private key
 *   AUDIT_AGENT_ID      — registered agent ID
 *
 * Optional env vars:
 *   AUDIT_NETWORK       — mantle | base | arbitrum | optimism | polygon (default: base)
 *   AUDIT_RISK_LEVEL    — 0 | 1 | 2 (default: 0)
 *   AUDIT_SILENT        — true | false (default: false)
 */
export function createAgentAuditHandler(
  overrides?: Partial<AgentAuditHandlerConfig>
): AgentAuditHandler {
  const privateKey = process.env.AUDIT_PRIVATE_KEY;
  const agentId    = process.env.AUDIT_AGENT_ID;

  if (!privateKey) throw new Error("AUDIT_PRIVATE_KEY env var required");
  if (!agentId)    throw new Error("AUDIT_AGENT_ID env var required");

  return new AgentAuditHandler({
    privateKey,
    agentId,
    network:          (process.env.AUDIT_NETWORK as keyof typeof NETWORKS) || "base",
    defaultRiskLevel: (Number(process.env.AUDIT_RISK_LEVEL) || 0) as 0 | 1 | 2,
    silent:           process.env.AUDIT_SILENT === "true",
    ...overrides,
  });
}

// ─── Usage Example ────────────────────────────────────────────────────────────
//
// import { AgentAuditHandler, createAgentAuditHandler } from "@agentauditai/langchain";
//
// // Option 1: From env vars
// const handler = createAgentAuditHandler();
//
// // Option 2: Explicit config
// const handler = new AgentAuditHandler({
//   privateKey: process.env.AUDIT_PRIVATE_KEY!,
//   agentId: 1,
//   network: "base",
//   defaultRiskLevel: 0,
// });
//
// // Use with any LangChain chain or agent
// const chain = new AgentExecutor({
//   agent,
//   tools,
//   callbacks: [handler],
// });
//
// const result = await chain.invoke({ input: "..." });
// // Every LLM call, tool use, and chain step is now logged on-chain ✅
