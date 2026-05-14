import { AuditedOpenAI, AuditRecord } from "../../sdk/src/openai";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogAction = jest.fn().mockResolvedValue({ txHash: "0xdeadbeef" });

jest.mock("../../sdk/src/index", () => ({
  AgentAudit: jest.fn().mockImplementation(() => ({ logAction: mockLogAction })),
}));

const mockCreate = jest.fn();

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG = {
  agentAudit: { privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  agentId: 7,
  riskLevel: "HIGH" as const,
  openaiApiKey: "sk-test",
};

const MESSAGES: { role: "user"; content: string }[] = [
  { role: "user", content: "Should I approve this loan?" },
];

const CHAT_COMPLETION = {
  id: "chatcmpl-abc",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Yes, approve it." },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
};

function makeChunks(words: string[]): object[] {
  return words.map((w, i) => ({
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: { content: w },
        finish_reason: i === words.length - 1 ? "stop" : null,
      },
    ],
    usage: i === words.length - 1 ? { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } : null,
  }));
}

async function* asyncChunks(chunks: object[]) {
  for (const chunk of chunks) yield chunk;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Construction ─────────────────────────────────────────────────────────────

describe("AuditedOpenAI constructor", () => {
  it("creates an instance with chat.completions.create", () => {
    const client = new AuditedOpenAI(CONFIG);
    expect(typeof client.chat.completions.create).toBe("function");
  });

  it("defaults riskLevel to HIGH when omitted", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI({ ...CONFIG, riskLevel: undefined });
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });
    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.risk_level).toBe("HIGH");
  });
});

// ─── Non-streaming ────────────────────────────────────────────────────────────

describe("Non-streaming create", () => {
  it("returns the OpenAI response unchanged", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    const result = await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });
    expect(result).toEqual(CHAT_COMPLETION);
  });

  it("calls logAction with correct agentId and actionType", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 7, actionType: "LLM_DECISION" })
    );
  });

  it("audit record contains correct model and token counts", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("gpt-4o");
    expect(payload.input_tokens).toBe(20);
    expect(payload.output_tokens).toBe(5);
    expect(payload.finish_reason).toBe("stop");
    expect(payload.messages).toBe(1);
  });

  it("audit record uses hashed payloads, not raw content", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Raw content must never appear in the on-chain payload
    expect(JSON.stringify(payload)).not.toContain("Should I approve this loan");
    expect(JSON.stringify(payload)).not.toContain("Yes, approve it");
  });

  it("audit record has wrapper identifier and risk_level", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.wrapper).toBe("agentaudit-openai/1.0");
    expect(payload.risk_level).toBe("HIGH");
  });

  it("records latency_ms as a positive number", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("throws when audit log fails", async () => {
    mockCreate.mockResolvedValueOnce(CHAT_COMPLETION);
    mockLogAction.mockRejectedValueOnce(new Error("chain error"));
    const client = new AuditedOpenAI(CONFIG);
    await expect(
      client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES })
    ).rejects.toThrow("chain error");
  });

  it("identical prompts produce identical prompt_hash", async () => {
    mockCreate.mockResolvedValue(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });

    const hash1 = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;
    const hash2 = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;
    expect(hash1).toBe(hash2);
  });

  it("different prompts produce different prompt_hash", async () => {
    mockCreate.mockResolvedValue(CHAT_COMPLETION);
    const client = new AuditedOpenAI(CONFIG);
    await client.chat.completions.create({ model: "gpt-4o", messages: MESSAGES });
    await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Different question" }],
    });

    const hash1 = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;
    const hash2 = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;
    expect(hash1).not.toBe(hash2);
  });
});

// ─── Streaming ────────────────────────────────────────────────────────────────

describe("Streaming create", () => {
  const WORDS = ["Yes,", " go", " ahead."];

  it("yields all chunks from the original stream", async () => {
    const stream = asyncChunks(makeChunks(WORDS));
    mockCreate.mockResolvedValueOnce(stream);
    const client = new AuditedOpenAI(CONFIG);

    const result = await client.chat.completions.create({
      model: "gpt-4o",
      messages: MESSAGES,
      stream: true,
    });

    const received: object[] = [];
    for await (const chunk of result) received.push(chunk);

    expect(received).toHaveLength(WORDS.length);
  });

  it("logs on-chain after stream is fully consumed", async () => {
    const stream = asyncChunks(makeChunks(WORDS));
    mockCreate.mockResolvedValueOnce(stream);
    const client = new AuditedOpenAI(CONFIG);

    const result = await client.chat.completions.create({
      model: "gpt-4o",
      messages: MESSAGES,
      stream: true,
    });

    // Audit should not have fired yet (stream not consumed)
    expect(mockLogAction).not.toHaveBeenCalled();

    for await (const _ of result) { /* consume */ }

    // Give the finally block's fire-and-forget a tick to resolve
    await new Promise((r) => setImmediate(r));
    expect(mockLogAction).toHaveBeenCalledTimes(1);
  });

  it("accumulates content correctly across chunks", async () => {
    const stream = asyncChunks(makeChunks(WORDS));
    mockCreate.mockResolvedValueOnce(stream);
    const client = new AuditedOpenAI(CONFIG);

    const result = await client.chat.completions.create({
      model: "gpt-4o",
      messages: MESSAGES,
      stream: true,
    });

    for await (const _ of result) { /* consume */ }
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    // The hash of the full concatenated content must be deterministic
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Raw content must not appear on-chain
    expect(JSON.stringify(payload)).not.toContain("Yes, go ahead");
  });

  it("fires audit even when caller breaks early", async () => {
    const stream = asyncChunks(makeChunks(WORDS));
    mockCreate.mockResolvedValueOnce(stream);
    const client = new AuditedOpenAI(CONFIG);

    const result = await client.chat.completions.create({
      model: "gpt-4o",
      messages: MESSAGES,
      stream: true,
    });

    // eslint-disable-next-line no-unreachable-loop
    for await (const _ of result) {
      break; // break after first chunk
    }

    await new Promise((r) => setImmediate(r));
    expect(mockLogAction).toHaveBeenCalledTimes(1);
  });

  it("audit failure on streaming does not throw at the caller", async () => {
    const stream = asyncChunks(makeChunks(WORDS));
    mockCreate.mockResolvedValueOnce(stream);
    mockLogAction.mockRejectedValueOnce(new Error("chain down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const client = new AuditedOpenAI(CONFIG);
    const result = await client.chat.completions.create({
      model: "gpt-4o",
      messages: MESSAGES,
      stream: true,
    });

    await expect(async () => {
      for await (const _ of result) { /* consume */ }
    }).not.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(consoleSpy).toHaveBeenCalledWith(
      "[AuditedOpenAI] audit log failed:",
      "chain down"
    );
    consoleSpy.mockRestore();
  });
});
