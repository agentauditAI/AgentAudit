import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import { createHash } from "crypto";
import { AgentAudit, type AgentAuditConfig } from "./index";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AuditedOpenAIConfig {
  /** AgentAudit SDK config (private key + optional RPC URL) */
  agentAudit: AgentAuditConfig;
  /** On-chain numeric agent ID from AgentRegistration */
  agentId: number;
  /** EU AI Act risk classification — determines which articles are triggered */
  riskLevel?: "HIGH" | "MEDIUM" | "LOW";
  /** OpenAI API key — falls back to OPENAI_API_KEY env var if omitted */
  openaiApiKey?: string;
}

// ─── Audit record (safe to log on-chain — contains hashes, never raw data) ──

export interface AuditRecord {
  wrapper: string;
  model: string;
  messages: number;
  /** sha256 of JSON.stringify(messages) — caller keeps originals off-chain */
  prompt_hash: string;
  /** sha256 of the full response content */
  response_hash: string;
  finish_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  risk_level: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

// ─── Wrapper class ────────────────────────────────────────────────────────────

/**
 * Drop-in OpenAI wrapper that automatically logs every LLM decision on-chain
 * via the AgentAudit SDK. Follows the hashed-payload pattern so no sensitive
 * prompt/response content is ever written to the blockchain.
 *
 * Usage:
 *   const client = new AuditedOpenAI({ agentAudit: { privateKey }, agentId: 1 });
 *   const res = await client.chat.completions.create({ model: "gpt-4o", messages });
 */
export class AuditedOpenAI {
  private readonly openai: OpenAI;
  private readonly sdk: AgentAudit;
  private readonly agentId: number;
  private readonly riskLevel: "HIGH" | "MEDIUM" | "LOW";

  readonly chat: {
    completions: {
      /** Non-streaming call — awaits audit before returning; throws if audit fails */
      create(
        body: OpenAI.ChatCompletionCreateParamsNonStreaming,
        options?: OpenAI.RequestOptions
      ): Promise<OpenAI.ChatCompletion>;
      /** Streaming call — logs on-chain after stream is fully consumed */
      create(
        body: OpenAI.ChatCompletionCreateParamsStreaming,
        options?: OpenAI.RequestOptions
      ): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>>;
      create(
        body: OpenAI.ChatCompletionCreateParams,
        options?: OpenAI.RequestOptions
      ): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>>;
    };
  };

  constructor(config: AuditedOpenAIConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.sdk = new AgentAudit(config.agentAudit);
    this.agentId = config.agentId;
    this.riskLevel = config.riskLevel ?? "HIGH";

    const self = this;
    this.chat = {
      completions: {
        create(body: any, options?: OpenAI.RequestOptions): any {
          return body.stream
            ? self._streamingCreate(body, options)
            : self._standardCreate(body, options);
        },
      },
    };
  }

  // ─── Non-streaming ──────────────────────────────────────────────────────────

  private async _standardCreate(
    body: OpenAI.ChatCompletionCreateParamsNonStreaming,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.ChatCompletion> {
    const start = Date.now();
    const response = await this.openai.chat.completions.create(body, options);
    const latency_ms = Date.now() - start;

    const record: AuditRecord = {
      wrapper: "agentaudit-openai/1.0",
      model: response.model,
      messages: body.messages.length,
      prompt_hash: sha256(JSON.stringify(body.messages)),
      response_hash: sha256(response.choices[0]?.message?.content ?? ""),
      finish_reason: response.choices[0]?.finish_reason ?? null,
      input_tokens: response.usage?.prompt_tokens ?? null,
      output_tokens: response.usage?.completion_tokens ?? null,
      latency_ms,
      risk_level: this.riskLevel,
    };

    await this._auditLog(record);
    return response;
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  private async _streamingCreate(
    body: OpenAI.ChatCompletionCreateParamsStreaming,
    options?: OpenAI.RequestOptions
  ): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>> {
    const start = Date.now();
    const stream: Stream<OpenAI.ChatCompletionChunk> =
      await this.openai.chat.completions.create(body, options);
    const self = this;

    // Passthrough generator: forwards every chunk to the caller while
    // accumulating content for the audit log. The finally block fires
    // even if the caller breaks out of the loop early.
    async function* passthrough(): AsyncGenerator<OpenAI.ChatCompletionChunk> {
      let content = "";
      let finishReason: string | null = null;
      let model = body.model;
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;

      try {
        for await (const chunk of stream) {
          content += chunk.choices[0]?.delta?.content ?? "";
          finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
          if (chunk.model) model = chunk.model;
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? null;
            outputTokens = chunk.usage.completion_tokens ?? null;
          }
          yield chunk;
        }
      } finally {
        const record: AuditRecord = {
          wrapper: "agentaudit-openai/1.0",
          model,
          messages: body.messages.length,
          prompt_hash: sha256(JSON.stringify(body.messages)),
          response_hash: sha256(content),
          finish_reason: finishReason,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          latency_ms: Date.now() - start,
          risk_level: self.riskLevel,
        };
        self._auditLog(record).catch((err: Error) => {
          console.error("[AuditedOpenAI] audit log failed:", err.message);
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
