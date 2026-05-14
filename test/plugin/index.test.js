"use strict";

// ─── Env setup (before require so the plugin's load-time warn is suppressed) ─

process.env.AUDIT_PRIVATE_KEY     = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.AUDIT_NETWORK         = "mantle";
process.env.AUDIT_AGENT_ID        = "1";
process.env.AUDIT_INCIDENT_REGISTRY = "0xincidentregistry";
process.env.AUDIT_MONITOR_ADDRESS   = "0xmonitoraddress";

// ─── Ethers mock ─────────────────────────────────────────────────────────────

jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: jest.fn(),
    Wallet:          jest.fn(),
    Contract:        jest.fn(),
    keccak256:       jest.fn(),
    toUtf8Bytes:     jest.fn(),
    parseEther:      jest.fn(),
    id:              jest.fn(),
    ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
}));

// ─── Plugin require (after mocks are hoisted) ─────────────────────────────────

const plugin = require("../../plugin-elizaos/index.js");
const { ethers } = require("ethers");

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockTx;
let mockContract;

beforeEach(() => {
  jest.clearAllMocks();

  mockTx = { hash: "0xdeadbeef", wait: jest.fn().mockResolvedValue({}) };

  mockContract = {
    registerAgent:   jest.fn().mockResolvedValue(mockTx),
    logAction:       jest.fn().mockResolvedValue(mockTx),
    logActionBatch:  jest.fn().mockResolvedValue(mockTx),
    getLogCount:     jest.fn().mockResolvedValue(42n),
    registerIncident: jest.fn().mockResolvedValue(mockTx),
    recordMetric:    jest.fn().mockResolvedValue(mockTx),
  };

  ethers.JsonRpcProvider.mockReturnValue({});
  ethers.Wallet.mockReturnValue({ connect: jest.fn().mockReturnThis(), address: "0xwallet" });
  ethers.Contract.mockReturnValue(mockContract);
  ethers.keccak256.mockReturnValue("0xpayloadhash");
  ethers.toUtf8Bytes.mockReturnValue(new Uint8Array());
  ethers.parseEther.mockReturnValue(100n);
  ethers.id.mockReturnValue("0xagentbytes32");
});

// ─── Plugin shape ─────────────────────────────────────────────────────────────

describe("plugin shape", () => {
  it("exports name and description", () => {
    expect(plugin.name).toBe("agent-audit");
    expect(typeof plugin.description).toBe("string");
  });

  it("exports 6 actions", () => {
    expect(plugin.actions).toHaveLength(6);
  });

  it("every action has name, validate, handler, examples", () => {
    for (const action of plugin.actions) {
      expect(typeof action.name).toBe("string");
      expect(typeof action.validate).toBe("function");
      expect(typeof action.handler).toBe("function");
      expect(Array.isArray(action.examples)).toBe(true);
    }
  });

  it("exports middleware function", () => {
    expect(typeof plugin.middleware).toBe("function");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const runtime = { agentId: "test-agent" };
const message = { content: { text: "Transfer 100 USDC" }, roomId: "room-1" };

function getAction(name) {
  return plugin.actions.find((a) => a.name === name);
}

// ─── REGISTER_AGENT ───────────────────────────────────────────────────────────

describe("REGISTER_AGENT", () => {
  const action = () => getAction("REGISTER_AGENT");

  describe("validate", () => {
    it("returns true when AUDIT_PRIVATE_KEY is set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });

    it("returns false when AUDIT_PRIVATE_KEY is missing", async () => {
      const saved = process.env.AUDIT_PRIVATE_KEY;
      delete process.env.AUDIT_PRIVATE_KEY;
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_PRIVATE_KEY = saved;
    });
  });

  describe("handler", () => {
    it("returns true on success", async () => {
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(true);
    });

    it("calls registerAgent on the contract", async () => {
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(mockContract.registerAgent).toHaveBeenCalledTimes(1);
    });

    it("calls callback with txHash and network", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ txHash: "0xdeadbeef", network: "mantle" })
      );
    });

    it("uses agentName from options when provided", async () => {
      await action().handler(runtime, message, {}, { agentName: "my-bot" }, jest.fn());
      expect(mockContract.registerAgent).toHaveBeenCalledWith(
        "my-bot",
        expect.any(String),
        expect.anything(),
        expect.any(String)
      );
    });

    it("returns false and calls callback on error", async () => {
      mockContract.registerAgent.mockRejectedValueOnce(new Error("reverted"));
      const cb = jest.fn();
      const result = await action().handler(runtime, message, {}, {}, cb);
      expect(result).toBe(false);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("reverted") }));
    });
  });
});

// ─── LOG_AUDIT ────────────────────────────────────────────────────────────────

describe("LOG_AUDIT", () => {
  const action = () => getAction("LOG_AUDIT");

  describe("validate", () => {
    it("returns true when AUDIT_PRIVATE_KEY and AUDIT_AGENT_ID are set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });

    it("returns false when AUDIT_AGENT_ID is missing", async () => {
      const saved = process.env.AUDIT_AGENT_ID;
      delete process.env.AUDIT_AGENT_ID;
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_AGENT_ID = saved;
    });
  });

  describe("handler", () => {
    it("returns true on success", async () => {
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(true);
    });

    it("calls logAction on the contract with agentId, actionType, payloadHash, riskLevel", async () => {
      await action().handler(runtime, message, {}, { actionType: "TRANSFER", riskLevel: "HIGH" }, jest.fn());
      expect(mockContract.logAction).toHaveBeenCalledWith(
        process.env.AUDIT_AGENT_ID,
        "TRANSFER",
        "0xpayloadhash",
        2 // HIGH = 2
      );
    });

    it("defaults actionType to MESSAGE and riskLevel to LOW (0)", async () => {
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(mockContract.logAction).toHaveBeenCalledWith(
        process.env.AUDIT_AGENT_ID,
        "MESSAGE",
        "0xpayloadhash",
        0 // LOW = 0
      );
    });

    it("uses MEDIUM risk level (1) correctly", async () => {
      await action().handler(runtime, message, {}, { riskLevel: "MEDIUM" }, jest.fn());
      expect(mockContract.logAction).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 1
      );
    });

    it("calls callback with txHash, network, and payloadHash", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ txHash: "0xdeadbeef", payloadHash: "0xpayloadhash" })
      );
    });

    it("returns false and calls callback on error", async () => {
      mockContract.logAction.mockRejectedValueOnce(new Error("gas limit"));
      const cb = jest.fn();
      const result = await action().handler(runtime, message, {}, {}, cb);
      expect(result).toBe(false);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("gas limit") }));
    });
  });
});

// ─── LOG_AUDIT_BATCH ──────────────────────────────────────────────────────────

describe("LOG_AUDIT_BATCH", () => {
  const action = () => getAction("LOG_AUDIT_BATCH");

  const actions = [
    { type: "TRANSFER", payload: "send 10 USDC", riskLevel: "LOW" },
    { type: "APPROVE",  payload: "approve token", riskLevel: "HIGH" },
  ];

  describe("validate", () => {
    it("returns true when keys are set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });
  });

  describe("handler", () => {
    it("calls logActionBatch with correct arrays", async () => {
      await action().handler(runtime, message, {}, { actions }, jest.fn());
      expect(mockContract.logActionBatch).toHaveBeenCalledWith(
        process.env.AUDIT_AGENT_ID,
        ["TRANSFER", "APPROVE"],
        ["0xpayloadhash", "0xpayloadhash"],
        [0, 2] // LOW=0, HIGH=2
      );
    });

    it("returns false and errors when actions array is empty", async () => {
      const cb = jest.fn();
      const result = await action().handler(runtime, message, {}, { actions: [] }, cb);
      expect(result).toBe(false);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("No actions") })
      );
    });

    it("calls callback with count on success", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { actions }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ count: 2, txHash: "0xdeadbeef" }));
    });

    it("returns false on contract error", async () => {
      mockContract.logActionBatch.mockRejectedValueOnce(new Error("batch failed"));
      const result = await action().handler(runtime, message, {}, { actions }, jest.fn());
      expect(result).toBe(false);
    });
  });
});

// ─── REPORT_INCIDENT ─────────────────────────────────────────────────────────

describe("REPORT_INCIDENT", () => {
  const action = () => getAction("REPORT_INCIDENT");

  describe("validate", () => {
    it("returns true when AUDIT_PRIVATE_KEY and AUDIT_INCIDENT_REGISTRY are set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });

    it("returns false when AUDIT_INCIDENT_REGISTRY is missing", async () => {
      const saved = process.env.AUDIT_INCIDENT_REGISTRY;
      delete process.env.AUDIT_INCIDENT_REGISTRY;
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_INCIDENT_REGISTRY = saved;
    });
  });

  describe("handler", () => {
    it("calls registerIncident on the contract", async () => {
      const result = await action().handler(runtime, message, {}, { severity: 2, description: "Critical failure" }, jest.fn());
      expect(result).toBe(true);
      expect(mockContract.registerIncident).toHaveBeenCalledWith(
        expect.anything(),
        2,
        "Critical failure",
        expect.any(String),
        expect.any(Number)
      );
    });

    it("callback text includes severity label and tx hash", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { severity: 2 }, cb);
      const text = cb.mock.calls[0][0].text;
      expect(text).toMatch(/HIGH/i);
      expect(cb.mock.calls[0][0].txHash).toBe("0xdeadbeef");
    });

    it("defaults severity to 1 (MEDIUM) when not provided", async () => {
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(mockContract.registerIncident).toHaveBeenCalledWith(
        expect.anything(), 1, expect.any(String), expect.any(String), expect.any(Number)
      );
    });

    it("returns false on error", async () => {
      mockContract.registerIncident.mockRejectedValueOnce(new Error("registry error"));
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(false);
    });
  });
});

// ─── RECORD_METRIC ────────────────────────────────────────────────────────────

describe("RECORD_METRIC", () => {
  const action = () => getAction("RECORD_METRIC");

  describe("validate", () => {
    it("returns true when AUDIT_PRIVATE_KEY and AUDIT_MONITOR_ADDRESS are set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });

    it("returns false when AUDIT_MONITOR_ADDRESS is missing", async () => {
      const saved = process.env.AUDIT_MONITOR_ADDRESS;
      delete process.env.AUDIT_MONITOR_ADDRESS;
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_MONITOR_ADDRESS = saved;
    });
  });

  describe("handler", () => {
    it("calls recordMetric on the contract with default values", async () => {
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(true);
      expect(mockContract.recordMetric).toHaveBeenCalledWith(
        expect.any(String), // agent address
        3,                  // COMPLIANCE_SCORE
        "compliance_score",
        9000,
        8000,
        "auto",
        ethers.ZeroHash
      );
    });

    it("uses options values when provided", async () => {
      // metricType uses ||, so 0 would fall back to the default — use a truthy value
      await action().handler(runtime, message, {}, {
        metricType: 1,
        metricName: "error_rate",
        value: 150,
        threshold: 200,
        context: "prod-v2",
      }, jest.fn());
      expect(mockContract.recordMetric).toHaveBeenCalledWith(
        expect.any(String), 1, "error_rate", 150, 200, "prod-v2", ethers.ZeroHash
      );
    });

    it("calls callback with metric name and value", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { metricName: "drift_score", value: 500 }, cb);
      expect(cb.mock.calls[0][0].text).toMatch(/drift_score/);
      expect(cb.mock.calls[0][0].text).toMatch(/500/);
    });

    it("returns false on error", async () => {
      mockContract.recordMetric.mockRejectedValueOnce(new Error("monitor error"));
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(false);
    });
  });
});

// ─── AUDIT_STATUS ─────────────────────────────────────────────────────────────

describe("AUDIT_STATUS", () => {
  const action = () => getAction("AUDIT_STATUS");

  describe("validate", () => {
    it("returns true when AUDIT_PRIVATE_KEY and AUDIT_AGENT_ID are set", async () => {
      expect(await action().validate(runtime, message)).toBe(true);
    });
  });

  describe("handler", () => {
    it("calls getLogCount on the contract", async () => {
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(mockContract.getLogCount).toHaveBeenCalledTimes(1);
    });

    it("callback includes log count, agent id, and network", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      const { text, count, network } = cb.mock.calls[0][0];
      expect(text).toMatch(/42/);
      expect(count).toBe("42");
      expect(network).toBe("mantle");
    });

    it("returns true on success", async () => {
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(true);
    });

    it("returns false on error", async () => {
      mockContract.getLogCount.mockRejectedValueOnce(new Error("rpc error"));
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(false);
    });
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────────

describe("middleware", () => {
  const next = jest.fn().mockResolvedValue(undefined);

  it("calls next() regardless of auto-log setting", async () => {
    await plugin.middleware(runtime, message, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not call logAction when AUDIT_AUTO_LOG is not set", async () => {
    delete process.env.AUDIT_AUTO_LOG;
    await plugin.middleware(runtime, message, {}, next);
    expect(mockContract.logAction).not.toHaveBeenCalled();
  });

  it("calls logAction when AUDIT_AUTO_LOG=true and AUDIT_AGENT_ID is set", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    await plugin.middleware(runtime, message, {}, next);
    expect(mockContract.logAction).toHaveBeenCalledWith(
      process.env.AUDIT_AGENT_ID,
      "AUTO_LOG",
      "0xpayloadhash",
      0
    );
    delete process.env.AUDIT_AUTO_LOG;
  });

  it("still calls next() even if auto-log chain call fails silently", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    mockContract.logAction.mockRejectedValueOnce(new Error("chain down"));
    await expect(plugin.middleware(runtime, message, {}, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
    delete process.env.AUDIT_AUTO_LOG;
  });
});

// ─── Network selection ────────────────────────────────────────────────────────

describe("network selection", () => {
  it("uses mantle RPC by default", async () => {
    await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(ethers.JsonRpcProvider).toHaveBeenCalledWith(
      expect.stringContaining("mantle.xyz")
    );
  });

  it("uses base RPC when AUDIT_NETWORK=base", async () => {
    process.env.AUDIT_NETWORK = "base";
    await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(ethers.JsonRpcProvider).toHaveBeenCalledWith(
      expect.stringContaining("base.org")
    );
    process.env.AUDIT_NETWORK = "mantle";
  });

  it("throws on unknown network", async () => {
    process.env.AUDIT_NETWORK = "ethereum";
    const result = await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(result).toBe(false);
    process.env.AUDIT_NETWORK = "mantle";
  });
});
