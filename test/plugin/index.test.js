"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// ─── Env setup (before require so the plugin's load-time warn is suppressed) ─

const BATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentaudit-plugin-unit-"));

process.env.AUDIT_PRIVATE_KEY     = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.AUDIT_NETWORK         = "mantle";
process.env.AUDIT_AGENT_ID        = "1";
process.env.AUDIT_INCIDENT_REGISTRY = "0xincidentregistry";
process.env.AUDIT_MONITOR_ADDRESS   = "0xmonitoraddress";
process.env.AUDIT_BATCH_DIR       = BATCH_DIR;

const SIGNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ─── Mocks ───────────────────────────────────────────────────────────────────
//
// ethers: only the network-facing classes are mocked; hashing stays real so the
// SDK's BatchBuffer / Merkle code runs for real.
// @agentauditai/sdk: only the AgentAudit client (chain I/O) is mocked.

jest.mock("ethers", () => {
  const actual = jest.requireActual("ethers");
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(),
      Wallet:          jest.fn(),
      Contract:        jest.fn(),
    },
  };
});

const mockSdk = {
  commitBatch:          jest.fn(),
  getAddress:           jest.fn(),
  assertBatchAnchoring: jest.fn(),
  registerAgent:        jest.fn(),
  reportIncident:       jest.fn(),
};

jest.mock("@agentauditai/sdk", () => {
  const actual = jest.requireActual("@agentauditai/sdk");
  return { ...actual, AgentAudit: jest.fn(() => mockSdk) };
});

// ─── Plugin require (after mocks are hoisted) ─────────────────────────────────

const plugin = require("../../plugin-elizaos/index.js");
const { ethers } = require("ethers");
const sdk = require("@agentauditai/sdk");

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockTx;
let mockContract;

beforeEach(() => {
  jest.clearAllMocks();
  plugin.batch._reset();
  process.env.AUDIT_NETWORK = "base";
  delete process.env.AUDIT_RPC_URL;
  delete process.env.AUDIT_VAULT_ADDRESS;
  delete process.env.AUDIT_AUTO_LOG;

  mockTx = { hash: "0xdeadbeef", wait: jest.fn().mockResolvedValue({}) };

  mockContract = {
    recordMetric:     jest.fn().mockResolvedValue(mockTx),
    getBatchCount:    jest.fn().mockResolvedValue(3n),
  };

  ethers.JsonRpcProvider.mockReturnValue({});
  ethers.Wallet.mockReturnValue({ address: SIGNER });
  ethers.Contract.mockReturnValue(mockContract);

  let batchIndex = 0;
  mockSdk.commitBatch.mockImplementation(async () => ({ txHash: "0xbatchtx", batchIndex: batchIndex++ }));
  mockSdk.getAddress.mockReturnValue(SIGNER);
  mockSdk.assertBatchAnchoring.mockImplementation(() => {});
  mockSdk.reportIncident.mockResolvedValue({ incidentId: 4, txHash: "0xincidenttx" });
  mockSdk.registerAgent.mockResolvedValue({ agentId: 0, txHash: "0xregtx", network: "Mantle Mainnet" });
});

afterAll(() => {
  fs.rmSync(BATCH_DIR, { recursive: true, force: true });
});

// ─── Plugin shape ─────────────────────────────────────────────────────────────

describe("plugin shape", () => {
  it("exports name and description", () => {
    expect(plugin.name).toBe("agent-audit");
    expect(typeof plugin.description).toBe("string");
  });

  it("exports the same 6 actions as 1.0.0", () => {
    expect(plugin.actions.map((a) => a.name)).toEqual([
      "REGISTER_AGENT", "LOG_AUDIT", "LOG_AUDIT_BATCH", "REPORT_INCIDENT", "RECORD_METRIC", "AUDIT_STATUS",
    ]);
  });

  it("every action has name, validate, handler, examples", () => {
    for (const action of plugin.actions) {
      expect(typeof action.name).toBe("string");
      expect(typeof action.validate).toBe("function");
      expect(typeof action.handler).toBe("function");
      expect(Array.isArray(action.examples)).toBe(true);
    }
  });

  it("exports middleware function and batch controls", () => {
    expect(typeof plugin.middleware).toBe("function");
    expect(typeof plugin.batch.flush).toBe("function");
    expect(typeof plugin.batch.close).toBe("function");
    expect(typeof plugin.batch.getInclusionProof).toBe("function");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const runtime = { agentId: "test-agent" };
const message = { content: { text: "Transfer 100 USDC" }, roomId: "room-1" };

function getAction(name) {
  return plugin.actions.find((a) => a.name === name);
}

function readBatchFile(batchId) {
  return JSON.parse(fs.readFileSync(path.join(BATCH_DIR, `${batchId}.json`), "utf8"));
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
    it("registers via the SDK on Mantle and returns true", async () => {
      const result = await action().handler(runtime, message, {}, {}, jest.fn());
      expect(result).toBe(true);
      expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({ network: "mantle" }));
      expect(mockSdk.registerAgent).toHaveBeenCalledWith({
        name: "test-agent", complianceLevel: "limited", spendLimit: undefined, auditVault: undefined,
      });
    });

    it("passes AUDIT_REGISTRATION_ADDRESS to the SDK", async () => {
      process.env.AUDIT_REGISTRATION_ADDRESS = "0xRegistry";
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({ registrationAddress: "0xRegistry" }));
      delete process.env.AUDIT_REGISTRATION_ADDRESS;
    });

    it("calls callback with txHash and network", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ txHash: "0xregtx", network: "mantle" }));
    });

    it("uses options when provided", async () => {
      await action().handler(runtime, message, {}, { agentName: "my-bot", compliance: "high", spendLimit: 5n, auditVault: "0xVault" }, jest.fn());
      expect(mockSdk.registerAgent).toHaveBeenCalledWith({ name: "my-bot", complianceLevel: "high", spendLimit: 5n, auditVault: "0xVault" });
    });

    it("returns false and calls callback on error", async () => {
      mockSdk.registerAgent.mockRejectedValueOnce(new Error("reverted"));
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
    it("buffers one action_ref without sending a transaction", async () => {
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, {}, cb)).toBe(true);
      expect(mockSdk.commitBatch).not.toHaveBeenCalled();
      expect(plugin.batch.pending()).toBe(1);
      const res = cb.mock.calls[0][0];
      expect(res.actionRef).toMatch(/^0x[0-9a-f]{64}$/);
      expect(res.txHash).toBeUndefined();
      expect(res.pending).toBe(1);
      expect(res.network).toBe("base");
    });

    it("payloadHash is sha256 of the canonical message content", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      expect(cb.mock.calls[0][0].payloadHash).toBe("sha256:" + sdk.sha256Hex(sdk.canonicalize(message.content)));
    });

    it("flush: true anchors immediately and returns the tx", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { flush: true, actionType: "TRANSFER", riskLevel: "HIGH" }, cb);
      expect(mockSdk.commitBatch).toHaveBeenCalledWith(expect.objectContaining({ agentAddress: SIGNER, eventCount: 1 }));
      const res = cb.mock.calls[0][0];
      expect(res.txHash).toBe("0xbatchtx");
      expect(res.text).toMatch(/anchored/);
    });

    it("stores a hashes-only batch file with the agent_action scope", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { flush: true, actionType: "TRANSFER", riskLevel: "medium" }, cb);
      const { actionRef, batchId, payloadHash } = cb.mock.calls[0][0];
      const entry = readBatchFile(batchId).entries[0];

      expect(entry.action_ref).toBe(actionRef);
      expect(entry.record).toEqual({ plugin: "agentaudit-elizaos/1.1", action_type: "TRANSFER", risk_level: "MEDIUM", payload_hash: payloadHash });
      expect(entry.preimage).toMatchObject({ action_type: "TRANSFER", agent_id: "1" });
      expect(entry.preimage.scope).toBe(`agent_action:elizaos:record_hash:${sdk.sha256Hex(sdk.canonicalize(entry.record))}`);
      expect(sdk.computeActionRef(entry.preimage)).toBe(actionRef);
      expect(JSON.stringify(readBatchFile(batchId))).not.toContain("Transfer 100 USDC");
    });

    it("defaults actionType to MESSAGE and unknown risk levels to LOW", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { flush: true, riskLevel: "EXTREME" }, cb);
      const entry = readBatchFile(cb.mock.calls[0][0].batchId).entries[0];
      expect(entry.record).toMatchObject({ action_type: "MESSAGE", risk_level: "LOW" });
    });

    it("returns false with the SDK's clear error on a network without AuditVault v2", async () => {
      mockSdk.assertBatchAnchoring.mockImplementation(() => {
        throw new Error("Batch anchoring is not available on Mantle Mainnet");
      });
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, {}, cb)).toBe(false);
      expect(cb).toHaveBeenCalledWith({ text: "AgentAudit error: Batch anchoring is not available on Mantle Mainnet" });
    });

    it("returns false and calls callback when the commit fails", async () => {
      mockSdk.commitBatch.mockRejectedValueOnce(new Error("gas limit"));
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, { flush: true }, cb)).toBe(false);
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
    it("anchors all actions in one commitBatch", async () => {
      expect(await action().handler(runtime, message, {}, { actions }, jest.fn())).toBe(true);
      expect(mockSdk.commitBatch).toHaveBeenCalledTimes(1);
      expect(mockSdk.commitBatch).toHaveBeenCalledWith(expect.objectContaining({ eventCount: 2, agentAddress: SIGNER }));
    });

    it("records type and risk per action, hashes only", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { actions }, cb);
      const batch = readBatchFile(cb.mock.calls[0][0].batchId);
      expect(batch.entries.map((e) => [e.record.action_type, e.record.risk_level])).toEqual([["TRANSFER", "LOW"], ["APPROVE", "HIGH"]]);
      expect(JSON.stringify(batch)).not.toContain("send 10 USDC");
    });

    it("returns false and errors when actions array is empty", async () => {
      const cb = jest.fn();
      const result = await action().handler(runtime, message, {}, { actions: [] }, cb);
      expect(result).toBe(false);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("No actions") }));
    });

    it("calls callback with count, txHash and actionRefs", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { actions }, cb);
      const res = cb.mock.calls[0][0];
      expect(res).toMatchObject({ count: 2, txHash: "0xbatchtx" });
      expect(res.actionRefs).toHaveLength(2);
      for (const ref of res.actionRefs) expect(plugin.batch.getInclusionProof(ref)).not.toBeNull();
    });

    it("returns false on commit error", async () => {
      mockSdk.commitBatch.mockRejectedValueOnce(new Error("batch failed"));
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

    it("returns true without AUDIT_INCIDENT_REGISTRY — the network default is used", async () => {
      const saved = process.env.AUDIT_INCIDENT_REGISTRY;
      delete process.env.AUDIT_INCIDENT_REGISTRY;
      expect(await action().validate(runtime, message)).toBe(true);
      process.env.AUDIT_INCIDENT_REGISTRY = saved;
    });

    it("returns false when AUDIT_PRIVATE_KEY is missing", async () => {
      const saved = process.env.AUDIT_PRIVATE_KEY;
      delete process.env.AUDIT_PRIVATE_KEY;
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_PRIVATE_KEY = saved;
    });

    it("returns false on an unknown network with no AUDIT_INCIDENT_REGISTRY", async () => {
      const saved = process.env.AUDIT_INCIDENT_REGISTRY;
      delete process.env.AUDIT_INCIDENT_REGISTRY;
      process.env.AUDIT_NETWORK = "nonexistent";
      expect(await action().validate(runtime, message)).toBe(false);
      process.env.AUDIT_INCIDENT_REGISTRY = saved;
    });
  });

  describe("handler", () => {
    it("calls sdk.reportIncident with mapped options", async () => {
      const result = await action().handler(runtime, message, {}, {
        severity: 2, harmType: "fundamental_rights_violation", affectedPersons: 12,
        description: "Critical failure", evidenceHash: "ipfs://cid", occurredAt: 1700000000,
      }, jest.fn());
      expect(result).toBe(true);
      expect(mockSdk.reportIncident).toHaveBeenCalledWith({
        agentId: "1",
        severity: "HIGH",
        harmType: "FUNDAMENTAL_RIGHTS_VIOLATION",
        affectedPersons: 12,
        description: "Critical failure",
        evidenceHash: "ipfs://cid",
        occurredAt: 1700000000,
      });
    });

    it("passes the AUDIT_INCIDENT_REGISTRY override to the SDK client", async () => {
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({ incidentRegistryAddress: "0xincidentregistry" }));
    });

    it("leaves the registry to the SDK network default when AUDIT_INCIDENT_REGISTRY is unset", async () => {
      const saved = process.env.AUDIT_INCIDENT_REGISTRY;
      delete process.env.AUDIT_INCIDENT_REGISTRY;
      await action().handler(runtime, message, {}, {}, jest.fn());
      expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({ incidentRegistryAddress: undefined }));
      process.env.AUDIT_INCIDENT_REGISTRY = saved;
    });

    it("defaults: MEDIUM severity, OTHER harm type, 0 affected persons, message text as description", async () => {
      await action().handler(runtime, { content: { text: "agent went rogue" } }, {}, {}, jest.fn());
      expect(mockSdk.reportIncident).toHaveBeenCalledWith(expect.objectContaining({
        severity: "MEDIUM", harmType: "OTHER", affectedPersons: 0, description: "agent went rogue",
        evidenceHash: undefined, occurredAt: undefined,
      }));
    });

    it("severity 0 and harmType 0 map to LOW / DEATH (no || fallback)", async () => {
      await action().handler(runtime, message, {}, { severity: 0, harmType: 0, affectedPersons: 0 }, jest.fn());
      expect(mockSdk.reportIncident).toHaveBeenCalledWith(expect.objectContaining({
        severity: "LOW", harmType: "DEATH", affectedPersons: 0,
      }));
    });

    it("accepts severity by name, case-insensitive", async () => {
      await action().handler(runtime, message, {}, { severity: "critical" }, jest.fn());
      expect(mockSdk.reportIncident.mock.calls[0][0].severity).toBe("CRITICAL");
    });

    it("passes options.agentId through unchanged (bytes32)", async () => {
      const raw = "0x" + "ab".repeat(32);
      await action().handler(runtime, message, {}, { agentId: raw }, jest.fn());
      expect(mockSdk.reportIncident.mock.calls[0][0].agentId).toBe(raw);
    });

    it("rejects an invalid severity without calling the SDK", async () => {
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, { severity: 7 }, cb)).toBe(false);
      expect(mockSdk.reportIncident).not.toHaveBeenCalled();
      expect(cb.mock.calls[0][0].text).toMatch(/Invalid severity: 7/);
    });

    it("rejects an invalid harmType without calling the SDK", async () => {
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, { harmType: "PAPERCUT" }, cb)).toBe(false);
      expect(mockSdk.reportIncident).not.toHaveBeenCalled();
      expect(cb.mock.calls[0][0].text).toMatch(/Invalid harmType: PAPERCUT/);
    });

    it("callback carries incident id, labels, deadline and tx hash", async () => {
      const cb = jest.fn();
      await action().handler(runtime, message, {}, { severity: 3, harmType: 1, affectedPersons: 2 }, cb);
      const payload = cb.mock.calls[0][0];
      expect(payload).toMatchObject({ incidentId: 4, txHash: "0xincidenttx", severity: "CRITICAL", harmType: "SERIOUS_HEALTH_HARM" });
      expect(payload.text).toMatch(/Incident #4/);
      expect(payload.text).toMatch(/within 2 days/);
      expect(payload.text).toMatch(/Affected persons: 2/);
    });

    it("returns false and reports the SDK error (e.g. no matching registry)", async () => {
      mockSdk.reportIncident.mockRejectedValueOnce(new Error("IncidentRegistry v2 is not available on Base Mainnet"));
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, {}, cb)).toBe(false);
      expect(cb.mock.calls[0][0].text).toMatch(/IncidentRegistry v2 is not available/);
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
        SIGNER,             // wallet address
        3,                  // COMPLIANCE_SCORE
        "compliance_score",
        9000,
        8000,
        "auto",
        ethers.ZeroHash
      );
    });

    it("uses options values when provided, passing txRef through unchanged", async () => {
      const txRef = "0x" + "cd".repeat(32);
      await action().handler(runtime, message, {}, {
        metricType: 1,
        metricName: "error_rate",
        value: 150,
        threshold: 200,
        context: "prod-v2",
        txRef,
      }, jest.fn());
      expect(mockContract.recordMetric).toHaveBeenCalledWith(
        expect.any(String), 1, "error_rate", 150, 200, "prod-v2", txRef
      );
    });

    it("known quirk (TODO): metricType 0 falls back to 3 because of ||", async () => {
      await action().handler(runtime, message, {}, { metricType: 0 }, jest.fn());
      expect(mockContract.recordMetric.mock.calls[0][1]).toBe(3);
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
    it("reads getBatchCount for the signer address from the v2 vault", async () => {
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, {}, cb)).toBe(true);
      expect(ethers.Contract).toHaveBeenCalledWith(sdk.NETWORKS.base.auditVault, expect.any(Array), expect.anything());
      expect(mockContract.getBatchCount).toHaveBeenCalledWith(SIGNER);
      const { text, count, network, pending } = cb.mock.calls[0][0];
      expect(count).toBe("3");
      expect(network).toBe("base");
      expect(pending).toBe(0);
      expect(text).toMatch(/Batch anchoring: available/);
      expect(text).toMatch(/Batches on-chain: 3/);
    });

    it("reports pending entries in the buffer", async () => {
      await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
      const cb = jest.fn();
      await action().handler(runtime, message, {}, {}, cb);
      expect(cb.mock.calls[0][0].pending).toBe(1);
    });

    it("on a network without AuditVault v2: still succeeds and says batching is unavailable", async () => {
      process.env.AUDIT_NETWORK = "mantle";
      mockSdk.assertBatchAnchoring.mockImplementation(() => {
        throw new Error("Batch anchoring is not available on Mantle Mainnet");
      });
      const cb = jest.fn();
      expect(await action().handler(runtime, message, {}, {}, cb)).toBe(true);
      expect(mockContract.getBatchCount).not.toHaveBeenCalled();
      const { text, count } = cb.mock.calls[0][0];
      expect(count).toBeNull();
      expect(text).toMatch(/Batch anchoring: unavailable — Batch anchoring is not available on Mantle Mainnet/);
    });

    it("returns false on rpc error", async () => {
      mockContract.getBatchCount.mockRejectedValueOnce(new Error("rpc error"));
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

  it("does not buffer anything when AUDIT_AUTO_LOG is not set", async () => {
    await plugin.middleware(runtime, message, {}, next);
    expect(plugin.batch.pending()).toBe(0);
  });

  it("buffers an AUTO_LOG entry when AUDIT_AUTO_LOG=true and AUDIT_AGENT_ID is set", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    await plugin.middleware(runtime, message, {}, next);
    expect(plugin.batch.pending()).toBe(1);
    const result = await plugin.batch.flush();
    const entry = readBatchFile(result.batchId).entries[0];
    expect(entry.record).toMatchObject({ action_type: "AUTO_LOG", risk_level: "LOW" });
  });

  it("still calls next() when batch anchoring is unavailable", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    mockSdk.assertBatchAnchoring.mockImplementation(() => { throw new Error("not v2"); });
    await expect(plugin.middleware(runtime, message, {}, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not wait for buffering (a hanging add/flush never blocks the agent)", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    const spy = jest.spyOn(sdk.BatchBuffer.prototype, "add").mockReturnValue(new Promise(() => {}));
    await plugin.middleware(runtime, message, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("swallows a rejected add (e.g. failed flush) without surfacing it", async () => {
    process.env.AUDIT_AUTO_LOG = "true";
    const spy = jest.spyOn(sdk.BatchBuffer.prototype, "add").mockRejectedValue(new Error("chain down"));
    await expect(plugin.middleware(runtime, message, {}, next)).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ─── Network selection ────────────────────────────────────────────────────────

describe("network selection", () => {
  it("builds the SDK client for AUDIT_NETWORK with its default RPC", async () => {
    process.env.AUDIT_NETWORK = "base";
    await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({
      network: "base", rpcUrl: expect.stringContaining("base.org"), auditVaultAddress: undefined,
    }));
  });

  it("defaults to mantle when AUDIT_NETWORK is unset", async () => {
    delete process.env.AUDIT_NETWORK;
    await getAction("AUDIT_STATUS").handler(runtime, message, {}, {}, jest.fn());
    expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({ network: "mantle" }));
  });

  it("honours AUDIT_RPC_URL and AUDIT_VAULT_ADDRESS", async () => {
    process.env.AUDIT_RPC_URL = "http://127.0.0.1:8545";
    process.env.AUDIT_VAULT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(sdk.AgentAudit).toHaveBeenCalledWith(expect.objectContaining({
      rpcUrl: "http://127.0.0.1:8545", auditVaultAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    }));
  });

  it("fails on unknown network", async () => {
    process.env.AUDIT_NETWORK = "ethereum";
    const result = await getAction("LOG_AUDIT").handler(runtime, message, {}, {}, jest.fn());
    expect(result).toBe(false);
  });
});
