import Anthropic from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/core/streaming";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages";
import { createHash } from "crypto";
import { AgentAudit, type AgentAuditConfig } from "./index";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AuditedAnthropicConfig {
  /** AgentAudit SDK config (private key + optional RPC URL) */
  agentAudit: AgentAuditConfig;
  /** On-chain numeric agent ID from AgentRegistration */
  agentId: number;
  /** EU AI Act risk classification — determines which articles are triggered */
  riskLevel?: "HIGH" | "MEDIUM" | "LOW";
  /** Anthropic API key — falls back to ANTHROPIC_API_KEY env var if omitted */
  anthropicApiKey?: string;
}

// ─── Audit record (safe to log on-chain — hashes only, no raw content) ───────

export interface AuditRecord {
  wrapper: string;
  model: string;
  messages: number;
  has_system: boolean;
  /** sha256 of JSON.stringify({ system, messages }) */
  prompt_hash: string;
  /** sha256 of all text content blocks concatenated */
  response_hash: string;
  stop_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  risk_level: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ─── Wrapper class ────────────────────────────────────────────────────────────

/**
 * Drop-in Anthropic client wrapper that automatically logs every Claude
 * decision on-chain via the AgentAudit SDK. Follows the hashed-payload
 * pattern — raw prompt/response content never touches the blockchain.
 *
 * Usage:
 *   const client = new AuditedAnthropic({ agentAudit: { privateKey }, agentId: 1 });
 *   const msg = await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages });
 */
export class AuditedAnthropic {
  private readonly anthropic: Anthropic;
  private readonly sdk: AgentAudit;
  private readonly agentId: number;
  private readonly riskLevel: "HIGH" | "MEDIUM" | "LOW";

  readonly messages: {
    /** Non-streaming call — awaits audit before returning; throws if audit fails */
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: Anthropic.RequestOptions
    ): Promise<Anthropic.Message>;
    /** Streaming call — logs on-chain after stream is fully consumed */
    create(
      body: Anthropic.MessageCreateParamsStreaming,
      options?: Anthropic.RequestOptions
    ): Promise<AsyncIterable<RawMessageStreamEvent>>;
    create(
      body: Anthropic.MessageCreateParams,
      options?: Anthropic.RequestOptions
    ): Promise<Anthropic.Message | AsyncIterable<RawMessageStreamEvent>>;
  };

  constructor(config: AuditedAnthropicConfig) {
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.sdk = new AgentAudit(config.agentAudit);
    this.agentId = config.agentId;
    this.riskLevel = config.riskLevel ?? "HIGH";

    const self = this;
    this.messages = {
      create(body: any, options?: Anthropic.RequestOptions): any {
        return body.stream
          ? self._streamingCreate(body, options)
          : self._standardCreate(body, options);
      },
    };
  }

  // ─── Non-streaming ──────────────────────────────────────────────────────────

  private async _standardCreate(
    body: Anthropic.MessageCreateParamsNonStreaming,
    options?: Anthropic.RequestOptions
  ): Promise<Anthropic.Message> {
    const start = Date.now();
    const response = await this.anthropic.messages.create(body, options);
    const latency_ms = Date.now() - start;

    const record: AuditRecord = {
      wrapper: "agentaudit-anthropic/1.0",
      model: response.model,
      messages: body.messages.length,
      has_system: !!body.system,
      prompt_hash: sha256(JSON.stringify({ system: body.system ?? null, messages: body.messages })),
      response_hash: sha256(extractText(response.content)),
      stop_reason: response.stop_reason,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
      latency_ms,
      risk_level: this.riskLevel,
    };

    await this._auditLog(record);
    return response;
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  private async _streamingCreate(
    body: Anthropic.MessageCreateParamsStreaming,
    options?: Anthropic.RequestOptions
  ): Promise<AsyncIterable<RawMessageStreamEvent>> {
    const start = Date.now();
    const stream: Stream<RawMessageStreamEvent> =
      await this.anthropic.messages.create(body, options);
    const self = this;

    // Passthrough generator: forwards every event while accumulating the data
    // needed for the audit record. The finally block fires even on early break.
    async function* passthrough(): AsyncGenerator<RawMessageStreamEvent> {
      let content = "";
      let stopReason: string | null = null;
      let model = body.model;
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;

      try {
        for await (const event of stream) {
          if (event.type === "message_start") {
            model = event.message.model ?? model;
            inputTokens = event.message.usage?.input_tokens ?? null;
          } else if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            content += event.delta.text;
          } else if (event.type === "message_delta") {
            stopReason = event.delta.stop_reason ?? stopReason;
            outputTokens = event.usage?.output_tokens ?? null;
          }
          yield event;
        }
      } finally {
        const record: AuditRecord = {
          wrapper: "agentaudit-anthropic/1.0",
          model,
          messages: body.messages.length,
          has_system: !!body.system,
          prompt_hash: sha256(JSON.stringify({ system: body.system ?? null, messages: body.messages })),
          response_hash: sha256(content),
          stop_reason: stopReason,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          latency_ms: Date.now() - start,
          risk_level: self.riskLevel,
        };
        self._auditLog(record).catch((err: Error) => {
          console.error("[AuditedAnthropic] audit log failed:", err.message);
        });
      }
    }

    return passthrough();
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
