import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { createHash } from "crypto";
import { AgentAudit, type AgentAuditConfig } from "./index";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AgentAuditCallbackConfig {
  /** AgentAudit SDK config (private key + optional RPC URL) */
  agentAudit: AgentAuditConfig;
  /** On-chain numeric agent ID from AgentRegistration */
  agentId: number;
  /** EU AI Act risk classification — determines which articles are triggered */
  riskLevel?: "HIGH" | "MEDIUM" | "LOW";
}

// ─── Audit record (safe to log on-chain — hashes only, no raw content) ───────

export interface AuditRecord {
  wrapper: string;
  model: string;
  /** Total message count across all prompts in the batch */
  messages: number;
  /** sha256 of JSON.stringify(messages[][]) */
  prompt_hash: string;
  /** sha256 of all generation texts concatenated */
  response_hash: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  risk_level: string;
}

// ─── Internal run state ───────────────────────────────────────────────────────

interface RunState {
  start: number;
  promptHash: string;
  model: string;
  messages: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function extractModelName(llm: Serialized): string {
  const kwargs = (llm as any).kwargs ?? {};
  return (kwargs.model ?? kwargs.modelName ?? llm.id?.at(-1) ?? "unknown") as string;
}

function extractTokens(llmOutput: Record<string, any> | undefined) {
  if (!llmOutput) return { inputTokens: null, outputTokens: null };
  // OpenAI via @langchain/openai: { tokenUsage: { promptTokens, completionTokens } }
  const t = llmOutput.tokenUsage;
  if (t) {
    return {
      inputTokens: (t.promptTokens ?? null) as number | null,
      outputTokens: (t.completionTokens ?? null) as number | null,
    };
  }
  // Anthropic via @langchain/anthropic: { usage: { input_tokens, output_tokens } }
  const u = llmOutput.usage;
  if (u) {
    return {
      inputTokens: (u.input_tokens ?? null) as number | null,
      outputTokens: (u.output_tokens ?? null) as number | null,
    };
  }
  return { inputTokens: null, outputTokens: null };
}

// ─── Callback handler ─────────────────────────────────────────────────────────

/**
 * LangChain callback handler that logs every LLM decision on-chain via
 * AgentAudit. Attach it to any model, chain, or agent — it works with both
 * streaming and non-streaming calls because LangChain always fires handleLLMEnd
 * with the complete output regardless of streaming mode.
 *
 * Usage (direct):
 *   const handler = new AgentAuditCallbackHandler({ agentAudit: { privateKey }, agentId: 1 });
 *   const model = new ChatOpenAI({ callbacks: [handler] });
 *
 * Usage (via withAudit helper):
 *   const model = withAudit(new ChatOpenAI(), { agentAudit: { privateKey }, agentId: 1 });
 */
export class AgentAuditCallbackHandler extends BaseCallbackHandler {
  readonly name = "AgentAuditCallbackHandler";

  private readonly sdk: AgentAudit;
  private readonly agentId: number;
  private readonly riskLevel: "HIGH" | "MEDIUM" | "LOW";
  // Keyed by runId — supports concurrent calls
  private readonly _runs = new Map<string, RunState>();

  constructor(config: AgentAuditCallbackConfig) {
    super();
    this.sdk = new AgentAudit(config.agentAudit);
    this.agentId = config.agentId;
    this.riskLevel = config.riskLevel ?? "HIGH";
  }

  // ─── Chat model start (primary path for modern LangChain usage) ─────────────

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string
  ): Promise<void> {
    this._runs.set(runId, {
      start: Date.now(),
      promptHash: sha256(JSON.stringify(messages)),
      model: extractModelName(llm),
      messages: messages.reduce((n, batch) => n + batch.length, 0),
    });
  }

  // ─── Plain LLM start (legacy text-completion models) ────────────────────────

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string
  ): Promise<void> {
    this._runs.set(runId, {
      start: Date.now(),
      promptHash: sha256(JSON.stringify(prompts)),
      model: extractModelName(llm),
      messages: prompts.length,
    });
  }

  // ─── LLM end — fires after both streaming and non-streaming completions ─────

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    this._runs.delete(runId);

    const text = output.generations.flat().map((g) => g.text).join("");
    const { inputTokens, outputTokens } = extractTokens(output.llmOutput);

    const record: AuditRecord = {
      wrapper: "agentaudit-langchain/1.0",
      model: run.model,
      messages: run.messages,
      prompt_hash: run.promptHash,
      response_hash: sha256(text),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - run.start,
      risk_level: this.riskLevel,
    };

    // Audit failures do not surface to the caller — consistent with streaming
    // behaviour in AuditedOpenAI / AuditedAnthropic.
    this._auditLog(record).catch((err: Error) => {
      console.error("[AgentAuditCallbackHandler] audit log failed:", err.message);
    });
  }

  // ─── Shared ─────────────────────────────────────────────────────────────────

  private async _auditLog(record: AuditRecord): Promise<void> {
    await this.sdk.logAction({
      agentId: this.agentId,
      actionType: "LLM_DECISION",
      payload: JSON.stringify(record),
    });
  }
}

// ─── withAudit helper ─────────────────────────────────────────────────────────

/**
 * Attach an AgentAudit callback to any LangChain runnable (model, chain, agent).
 * Returns the runnable with the callback pre-configured.
 *
 * Usage:
 *   const model = withAudit(new ChatOpenAI(), { agentAudit: { privateKey }, agentId: 1 });
 *   const result = await model.invoke([new HumanMessage("Hello")]);
 */
export function withAudit<T extends { withConfig(cfg: Record<string, unknown>): unknown }>(
  runnable: T,
  config: AgentAuditCallbackConfig
): ReturnType<T["withConfig"]> {
  const handler = new AgentAuditCallbackHandler(config);
  return runnable.withConfig({ callbacks: [handler] }) as ReturnType<T["withConfig"]>;
}
