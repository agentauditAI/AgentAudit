import { AgentAuditCallbackHandler, AuditRecord } from "../../sdk/src/langchain";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogAction = jest.fn().mockResolvedValue({ txHash: "0xdeadbeef" });

jest.mock("../../sdk/src/index", () => ({
  AgentAudit: jest.fn().mockImplementation(() => ({ logAction: mockLogAction })),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG = {
  agentAudit: { privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  agentId: 5,
  riskLevel: "HIGH" as const,
};

const RUN_ID = "run-abc-123";

// Minimal Serialized shape for a ChatOpenAI model
const CHAT_OPENAI_SERIALIZED = {
  lc: 1,
  type: "constructor",
  id: ["langchain", "chat_models", "openai", "ChatOpenAI"],
  kwargs: { model: "gpt-4o" },
};

// Minimal Serialized for a plain LLM (no modelName in kwargs — falls back to id)
const PLAIN_LLM_SERIALIZED = {
  lc: 1,
  type: "constructor",
  id: ["langchain", "llms", "openai", "OpenAI"],
  kwargs: {},
};

// Minimal Serialized for Anthropic
const CHAT_ANTHROPIC_SERIALIZED = {
  lc: 1,
  type: "constructor",
  id: ["langchain", "chat_models", "anthropic", "ChatAnthropic"],
  kwargs: { model: "claude-opus-4-7" },
};

// LangChain BaseMessage-like objects
const USER_MSG = { _getType: () => "human", content: "Is this compliant?" };
const AI_MSG   = { _getType: () => "ai",    content: "Yes, it is." };

// LLMResult shapes
function llmResult(
  text: string,
  llmOutput?: Record<string, any>
) {
  return {
    generations: [[{ text, message: AI_MSG, generationInfo: {} }]],
    llmOutput,
  };
}

const OPENAI_LLM_OUTPUT = {
  tokenUsage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
};

const ANTHROPIC_LLM_OUTPUT = {
  usage: { input_tokens: 20, output_tokens: 8 },
};

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ─── Construction ─────────────────────────────────────────────────────────────

describe("AgentAuditCallbackHandler constructor", () => {
  it("has the correct handler name", () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    expect(handler.name).toBe("AgentAuditCallbackHandler");
  });

  it("defaults riskLevel to HIGH when omitted", async () => {
    const handler = new AgentAuditCallbackHandler({ ...CONFIG, riskLevel: undefined });
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.risk_level).toBe("HIGH");
  });
});

// ─── handleChatModelStart + handleLLMEnd (primary path) ──────────────────────

describe("Chat model: start → end", () => {
  it("calls logAction with correct agentId and actionType", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 5, actionType: "LLM_DECISION" })
    );
  });

  it("extracts model name from kwargs.model", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("gpt-4o");
  });

  it("extracts model name from kwargs.modelName", async () => {
    const serialized = { ...CHAT_OPENAI_SERIALIZED, kwargs: { modelName: "gpt-3.5-turbo" } };
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(serialized as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("gpt-3.5-turbo");
  });

  it("falls back to last element of id when kwargs has no model", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(PLAIN_LLM_SERIALIZED as any, [["Prompt" as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("OpenAI");
  });

  it("hashes prompt and response, never puts raw content on-chain", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes, it is.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const raw = mockLogAction.mock.calls[0][0].payload as string;
    expect(raw).not.toContain("Is this compliant");
    expect(raw).not.toContain("Yes, it is");

    const payload = JSON.parse(raw) as AuditRecord;
    expect(payload.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("records correct message count for a batch", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    // Two prompts in one batch
    await handler.handleChatModelStart(
      CHAT_OPENAI_SERIALIZED as any,
      [[USER_MSG as any, AI_MSG as any], [USER_MSG as any]],
      RUN_ID
    );
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.messages).toBe(3); // 2 + 1
  });

  it("includes latency_ms as a non-negative number", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("sets wrapper identifier correctly", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.wrapper).toBe("agentaudit-langchain/1.0");
  });
});

// ─── Token extraction ─────────────────────────────────────────────────────────

describe("Token extraction", () => {
  async function getPayload(llmOutput?: Record<string, any>): Promise<AuditRecord> {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.", llmOutput) as any, RUN_ID);
    await new Promise((r) => setImmediate(r));
    return JSON.parse(mockLogAction.mock.calls[0][0].payload);
  }

  it("reads OpenAI tokenUsage format (promptTokens / completionTokens)", async () => {
    const payload = await getPayload(OPENAI_LLM_OUTPUT);
    expect(payload.input_tokens).toBe(20);
    expect(payload.output_tokens).toBe(8);
  });

  it("reads Anthropic usage format (input_tokens / output_tokens)", async () => {
    const payload = await getPayload(ANTHROPIC_LLM_OUTPUT);
    expect(payload.input_tokens).toBe(20);
    expect(payload.output_tokens).toBe(8);
  });

  it("returns null tokens when llmOutput is missing", async () => {
    const payload = await getPayload(undefined);
    expect(payload.input_tokens).toBeNull();
    expect(payload.output_tokens).toBeNull();
  });
});

// ─── Concurrent runs ──────────────────────────────────────────────────────────

describe("Concurrent runs", () => {
  it("tracks multiple concurrent runIds independently", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    const RUN_A = "run-a";
    const RUN_B = "run-b";

    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_A);
    await handler.handleChatModelStart(CHAT_ANTHROPIC_SERIALIZED as any, [[USER_MSG as any]], RUN_B);
    await handler.handleLLMEnd(llmResult("Response A", OPENAI_LLM_OUTPUT) as any, RUN_A);
    await handler.handleLLMEnd(llmResult("Response B", ANTHROPIC_LLM_OUTPUT) as any, RUN_B);
    await new Promise((r) => setImmediate(r));

    expect(mockLogAction).toHaveBeenCalledTimes(2);
    const payloadA = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    const payloadB = JSON.parse(mockLogAction.mock.calls[1][0].payload) as AuditRecord;

    expect(payloadA.model).toBe("gpt-4o");
    expect(payloadB.model).toBe("claude-opus-4-7");
    expect(payloadA.response_hash).not.toBe(payloadB.response_hash);
  });

  it("cleans up run state after handleLLMEnd", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    // Second end for same runId should not log again
    await handler.handleLLMEnd(llmResult("Duplicate.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));
    expect(mockLogAction).toHaveBeenCalledTimes(1);
  });
});

// ─── Plain LLM path (handleLLMStart) ─────────────────────────────────────────

describe("Plain LLM path (handleLLMStart)", () => {
  it("logs correctly via handleLLMStart for text-completion models", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    await handler.handleLLMStart(PLAIN_LLM_SERIALIZED as any, ["Complete this:"], RUN_ID);
    await handler.handleLLMEnd(llmResult("The answer.") as any, RUN_ID);
    await new Promise((r) => setImmediate(r));

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.messages).toBe(1);
  });
});

// ─── Audit failure ────────────────────────────────────────────────────────────

describe("Audit failure handling", () => {
  it("does not throw when audit log fails — logs to console.error", async () => {
    mockLogAction.mockRejectedValueOnce(new Error("chain down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = new AgentAuditCallbackHandler(CONFIG);

    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], RUN_ID);
    await expect(
      handler.handleLLMEnd(llmResult("Yes.") as any, RUN_ID)
    ).resolves.toBeUndefined();

    await new Promise((r) => setImmediate(r));
    expect(consoleSpy).toHaveBeenCalledWith(
      "[AgentAuditCallbackHandler] audit log failed:",
      "chain down"
    );
    consoleSpy.mockRestore();
  });
});

// ─── Identical inputs → identical hashes ─────────────────────────────────────

describe("Hash determinism", () => {
  it("same messages produce same prompt_hash across runs", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);

    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], "run-1");
    await handler.handleLLMEnd(llmResult("A.") as any, "run-1");
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], "run-2");
    await handler.handleLLMEnd(llmResult("A.") as any, "run-2");
    await new Promise((r) => setImmediate(r));

    const h1 = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;
    const h2 = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;
    expect(h1).toBe(h2);
  });

  it("different messages produce different prompt_hash", async () => {
    const handler = new AgentAuditCallbackHandler(CONFIG);
    const OTHER_MSG = { _getType: () => "human", content: "Different question" };

    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[USER_MSG as any]], "run-1");
    await handler.handleLLMEnd(llmResult("A.") as any, "run-1");
    await handler.handleChatModelStart(CHAT_OPENAI_SERIALIZED as any, [[OTHER_MSG as any]], "run-2");
    await handler.handleLLMEnd(llmResult("A.") as any, "run-2");
    await new Promise((r) => setImmediate(r));

    const h1 = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;
    const h2 = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;
    expect(h1).not.toBe(h2);
  });
});
