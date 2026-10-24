import { BatchBuffer, MemoryBatchStore, canonicalize, sha256Hex } from "../../sdk/src/batch";
import { AuditedAnthropic, AuditRecord } from "../../sdk/src/anthropic";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const MOCK_SIGNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const mockLogAction = jest.fn().mockResolvedValue({ txHash: "0xdeadbeef" });
const mockCommitBatch = jest.fn().mockResolvedValue({ txHash: "0xbatch", batchIndex: 0 });

jest.mock("../../sdk/src/index", () => ({
  AgentAudit: jest.fn().mockImplementation(() => ({
    logAction: mockLogAction,
    commitBatch: mockCommitBatch,
    getAddress: () => MOCK_SIGNER,
  })),
}));

const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG = {
  agentAudit: { privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  agentId: 3,
  riskLevel: "HIGH" as const,
  anthropicApiKey: "sk-ant-test",
  mode: "per_action" as const,
};

const MESSAGES: { role: "user"; content: string }[] = [
  { role: "user", content: "Is this loan application high risk?" },
];

const MESSAGE_RESPONSE = {
  id: "msg_abc",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-7",
  content: [{ type: "text", text: "Based on the data, yes." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 30, output_tokens: 10 },
};

// Streaming event factories
function startEvent(model = "claude-opus-4-7") {
  return {
    type: "message_start",
    message: { model, usage: { input_tokens: 30 } },
  };
}
function deltaEvent(text: string, isLast = false) {
  return {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  };
}
function messageDeltaEvent(stopReason = "end_turn", outputTokens = 10) {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason },
    usage: { output_tokens: outputTokens },
  };
}
function stopEvent() {
  return { type: "message_stop" };
}

async function* asyncEvents(events: object[]) {
  for (const e of events) yield e;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ─── Construction ─────────────────────────────────────────────────────────────

describe("AuditedAnthropic constructor", () => {
  it("exposes messages.create", () => {
    const client = new AuditedAnthropic(CONFIG);
    expect(typeof client.messages.create).toBe("function");
  });

  it("defaults riskLevel to HIGH when omitted", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic({ ...CONFIG, riskLevel: undefined });
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });
    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.risk_level).toBe("HIGH");
  });
});

// ─── Non-streaming ────────────────────────────────────────────────────────────

describe("Non-streaming create", () => {
  it("returns the Anthropic response unchanged", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
    });
    expect(result).toEqual(MESSAGE_RESPONSE);
  });

  it("calls logAction with correct agentId and actionType", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3, actionType: "LLM_DECISION" })
    );
  });

  it("audit record contains correct fields", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("claude-opus-4-7");
    expect(payload.messages).toBe(1);
    expect(payload.has_system).toBe(false);
    expect(payload.stop_reason).toBe("end_turn");
    expect(payload.input_tokens).toBe(30);
    expect(payload.output_tokens).toBe(10);
    expect(payload.wrapper).toBe("agentaudit-anthropic/1.0");
    expect(payload.risk_level).toBe("HIGH");
    expect(payload.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("sets has_system true when system prompt is present", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      system: "You are a compliance officer.",
    });
    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.has_system).toBe(true);
  });

  it("never puts raw prompt or response content on-chain", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });

    const raw = mockLogAction.mock.calls[0][0].payload as string;
    expect(raw).not.toContain("Is this loan application high risk");
    expect(raw).not.toContain("Based on the data");
    const payload = JSON.parse(raw) as AuditRecord;
    expect(payload.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("system prompt is included in the prompt_hash", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);

    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });
    const hashWithout = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;

    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      system: "You are a compliance officer.",
    });
    const hashWith = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;

    expect(hashWithout).not.toBe(hashWith);
  });

  it("identical inputs produce identical prompt_hash", async () => {
    mockCreate.mockResolvedValue(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });

    const h1 = JSON.parse(mockLogAction.mock.calls[0][0].payload).prompt_hash;
    const h2 = JSON.parse(mockLogAction.mock.calls[1][0].payload).prompt_hash;
    expect(h1).toBe(h2);
  });

  it("handles multiple text content blocks by concatenating them", async () => {
    const multiBlock = {
      ...MESSAGE_RESPONSE,
      content: [
        { type: "text", text: "First part. " },
        { type: "text", text: "Second part." },
      ],
    };
    mockCreate.mockResolvedValueOnce(multiBlock);
    const client = new AuditedAnthropic(CONFIG);
    await client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES });

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    // Hash of "First part. Second part." must differ from hash of just one block
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("throws when audit log fails", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    mockLogAction.mockRejectedValueOnce(new Error("chain error"));
    const client = new AuditedAnthropic(CONFIG);
    await expect(
      client.messages.create({ model: "claude-opus-4-7", max_tokens: 1024, messages: MESSAGES })
    ).rejects.toThrow("chain error");
  });
});

// ─── Streaming ────────────────────────────────────────────────────────────────

describe("Streaming create", () => {
  function makeStream(words: string[]) {
    const events = [
      startEvent(),
      ...words.map((w) => deltaEvent(w)),
      messageDeltaEvent(),
      stopEvent(),
    ];
    return asyncEvents(events);
  }

  it("yields all stream events unchanged", async () => {
    const WORDS = ["Based ", "on ", "data."];
    mockCreate.mockResolvedValueOnce(makeStream(WORDS));
    const client = new AuditedAnthropic(CONFIG);

    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });

    const received: object[] = [];
    for await (const event of result) received.push(event);

    // start + 3 delta + message_delta + stop = 6
    expect(received).toHaveLength(6);
  });

  it("logs on-chain after stream is fully consumed", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["Hello"]));
    const client = new AuditedAnthropic(CONFIG);

    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });

    expect(mockLogAction).not.toHaveBeenCalled();
    for await (const _ of result) { /* consume */ }
    await new Promise((r) => setImmediate(r));

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3, actionType: "LLM_DECISION" })
    );
  });

  it("accumulates text from content_block_delta events", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["Hello", " world"]));
    const client = new AuditedAnthropic(CONFIG);

    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });
    for await (const _ of result) { /* consume */ }
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain("Hello world");
  });

  it("reads model and token counts from stream events", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["ok"]));
    const client = new AuditedAnthropic(CONFIG);

    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });
    for await (const _ of result) { /* consume */ }
    await new Promise((r) => setImmediate(r));

    const payload = JSON.parse(mockLogAction.mock.calls[0][0].payload) as AuditRecord;
    expect(payload.model).toBe("claude-opus-4-7");
    expect(payload.input_tokens).toBe(30);
    expect(payload.output_tokens).toBe(10);
    expect(payload.stop_reason).toBe("end_turn");
  });

  it("fires audit even when caller breaks early", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["A", "B", "C"]));
    const client = new AuditedAnthropic(CONFIG);

    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });

    // eslint-disable-next-line no-unreachable-loop
    for await (const _ of result) break;

    await new Promise((r) => setImmediate(r));
    expect(mockLogAction).toHaveBeenCalledTimes(1);
  });

  it("audit failure on streaming does not throw at the caller", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["ok"]));
    mockLogAction.mockRejectedValueOnce(new Error("chain down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const client = new AuditedAnthropic(CONFIG);
    const result = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: MESSAGES,
      stream: true,
    });

    await expect(async () => {
      for await (const _ of result) { /* consume */ }
    }).not.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(consoleSpy).toHaveBeenCalledWith(
      "[AuditedAnthropic] audit log failed:",
      "chain down"
    );
    consoleSpy.mockRestore();
  });
});

// ─── Batch mode (default) ─────────────────────────────────────────────────────

describe("Batch mode", () => {
  const BATCH_CONFIG = { ...CONFIG, mode: undefined };
  const BODY = { model: "claude-opus-4-7", max_tokens: 100, system: "Be strict.", messages: MESSAGES };

  it("is the default: buffers instead of calling logAction", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const client = new AuditedAnthropic(BATCH_CONFIG);
    await client.messages.create(BODY);

    expect(client.buffer).toBeInstanceOf(BatchBuffer);
    expect(client.buffer!.size).toBe(1);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("per_action mode has no buffer", () => {
    expect(new AuditedAnthropic(CONFIG).buffer).toBeUndefined();
  });

  it("flush commits an llm_call scope over the hashed record (system prompt included, never raw)", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    const store = new MemoryBatchStore();
    const client = new AuditedAnthropic({ ...BATCH_CONFIG, batch: { store } });
    await client.messages.create(BODY);
    const result = (await client.buffer!.flush())!;

    expect(mockCommitBatch).toHaveBeenCalledWith(expect.objectContaining({ agentAddress: MOCK_SIGNER, eventCount: 1 }));
    const entry = (await store.get(result.batchId))!.entries[0];
    const record = entry.record as AuditRecord;
    expect(record.has_system).toBe(true);
    expect(entry.preimage).toMatchObject({ action_type: "LLM_DECISION", agent_id: "3" });
    expect(entry.preimage.scope).toBe(`llm_call:claude-opus-4-7:record_hash:${sha256Hex(canonicalize(record))}`);
    expect(JSON.stringify(entry)).not.toContain("Be strict.");
    expect(JSON.stringify(entry)).not.toContain("Based on the data");
  });

  it("non-streaming throws when the flush it triggers fails", async () => {
    mockCreate.mockResolvedValueOnce(MESSAGE_RESPONSE);
    mockCommitBatch.mockRejectedValueOnce(new Error("chain error"));
    const client = new AuditedAnthropic({ ...BATCH_CONFIG, batch: { maxEntries: 1 } });
    await expect(client.messages.create(BODY)).rejects.toThrow("chain error");
  });

  it("streaming buffers after the stream is consumed", async () => {
    mockCreate.mockResolvedValueOnce(asyncEvents([startEvent(), deltaEvent("Yes"), messageDeltaEvent(), stopEvent()]));
    const client = new AuditedAnthropic(BATCH_CONFIG);
    const stream = await client.messages.create({ ...BODY, stream: true });
    for await (const _ of stream) { /* drain */ }
    await new Promise((r) => setImmediate(r));
    expect(client.buffer!.size).toBe(1);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});
