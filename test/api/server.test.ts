import request from "supertest";
import { createApp } from "../../src/api/app";
import { expectNoComplianceClaims as expectNoClaimsStrict } from "./helpers/noComplianceClaims";

// Mock the chain module so tests never touch a real network
jest.mock("../../src/api/chain", () => {
  const registeredAgent = {
    registered: true,
    name: "TestAgent",
    operator: "0x1234",
    createdAt: 1700000000,
    complianceLevel: "high",
    spendLimit: "0",
    revoked: false,
  };
  const mockClient = {
    registrationAddress: "0x68769980879414e8f264Ac15a87813E2ABaBaD6e",
    auditBatchAddress: "0x00000000000000000000000000000000000000Ab" as string | null,
    logAction: jest.fn().mockResolvedValue("0xdeadbeefcafe"),
    getAuditTrail: jest.fn().mockResolvedValue([
      {
        agentId: "1",
        actionType: "transfer",
        payloadHash: "0xabc",
        timestamp: 1700000000,
        txHash: "0xdeadbeef",
        blockNumber: 123,
      },
    ]),
    getAgentInfo: jest.fn().mockResolvedValue(registeredAgent),
  };
  const mockVault = {
    vaultAddress: "0xCeE831070aa9081422f30df5559c125aa47A75DB",
    getBatchSummary: jest.fn().mockImplementation(async (agentAddress: string) => ({
      vaultAddress: "0xCeE831070aa9081422f30df5559c125aa47A75DB",
      agentAddress,
      batchCount: 3,
      lastBatch: { batchIndex: 2, blockNumber: 47100000, timestamp: 1780000000 },
    })),
  };

  class NetworkNotConfiguredError extends Error {
    constructor(network: string) {
      super(`Contract addresses not configured for network: ${network}`);
      this.name = "NetworkNotConfiguredError";
    }
  }
  class ContractConfigError extends Error {
    constructor(envVar: string, value: string) {
      super(`Invalid contract address in ${envVar}: "${value}" is not a valid EVM address.`);
      this.name = "ContractConfigError";
    }
  }
  class SignerNotConfiguredError extends Error {
    constructor() {
      super("Write endpoints need a signing key: set PRIVATE_KEY on the server. Read endpoints work without it.");
      this.name = "SignerNotConfiguredError";
    }
  }

  return {
    getChainClient: jest.fn().mockReturnValue(mockClient),
    getBaseVaultReader: jest.fn().mockReturnValue(mockVault),
    NetworkNotConfiguredError,
    ContractConfigError,
    SignerNotConfiguredError,
    _mockClient: mockClient,
    _mockVault: mockVault,
    _registeredAgent: registeredAgent,
  };
});

const {
  getChainClient,
  _mockClient: mockClient,
  _mockVault: mockVault,
  _registeredAgent: registeredAgent,
  NetworkNotConfiguredError,
  ContractConfigError,
  SignerNotConfiguredError,
} = require("../../src/api/chain");

const API_KEY = "test-api-key";

beforeAll(() => {
  process.env.API_KEY = API_KEY;
  process.env.PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
});

afterEach(() => {
  jest.clearAllMocks();
});

const app = createApp();
const auth = { Authorization: `Bearer ${API_KEY}` };

// ─── GET /v1/health ───────────────────────────────────────────────────────────

describe("GET /v1/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });

  it("does not require auth", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
  });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe("Auth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).post("/v1/audit").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authorization/i);
  });

  it("returns 401 when token is wrong", async () => {
    const res = await request(app)
      .post("/v1/audit")
      .set("Authorization", "Bearer wrong-key")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 401 when Bearer prefix is missing", async () => {
    const res = await request(app)
      .post("/v1/audit")
      .set("Authorization", API_KEY)
      .send({});
    expect(res.status).toBe(401);
  });
});

// ─── POST /v1/audit ───────────────────────────────────────────────────────────

describe("POST /v1/audit", () => {
  const validBody = {
    agent_id: "1",
    action: "transfer",
    decision: "approved",
    risk_level: "HIGH",
    network: "mantle",
    metadata: { amount: "100" },
  };

  it("logs an action and returns 201 with correct shape", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("logged");
    expect(res.body.audit_id).toBeDefined();
    expect(res.body.tx_hash).toBe("0xdeadbeefcafe");
    expect(res.body.articles).toEqual(["Art. 9", "Art. 12", "Art. 13", "Art. 19", "Art. 26", "Art. 72"]);
    expect(res.body.timestamp).toBeDefined();
  });

  it("returns correct articles for MEDIUM risk", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, risk_level: "MEDIUM" });
    expect(res.status).toBe(201);
    expect(res.body.articles).toEqual(["Art. 12", "Art. 13", "Art. 19"]);
  });

  it("returns correct articles for LOW risk", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, risk_level: "LOW" });
    expect(res.status).toBe(201);
    expect(res.body.articles).toEqual(["Art. 12", "Art. 19"]);
  });

  it("calls logAction with the right agentId and action", async () => {
    await request(app).post("/v1/audit").set(auth).send(validBody);
    expect(mockClient.logAction).toHaveBeenCalledWith(1, "transfer", expect.any(String));
  });

  it("returns 400 when agent_id is missing", async () => {
    const { agent_id, ...rest } = validBody;
    const res = await request(app).post("/v1/audit").set(auth).send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("returns 400 when agent_id is not numeric", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, agent_id: "0xabc" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when risk_level is invalid", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, risk_level: "CRITICAL" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when network is invalid", async () => {
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, network: "ethereum" });
    expect(res.status).toBe(400);
  });

  it("returns 503 when network has no configured contracts", async () => {
    getChainClient.mockImplementationOnce((network: string) => {
      throw new NetworkNotConfiguredError(network);
    });
    const res = await request(app).post("/v1/audit").set(auth).send({ ...validBody, network: "base" });
    expect(res.status).toBe(503);
  });

  it("returns 503 when no signing key is configured", async () => {
    mockClient.logAction.mockRejectedValueOnce(new SignerNotConfiguredError());
    const res = await request(app).post("/v1/audit").set(auth).send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/set PRIVATE_KEY on the server/);
  });

  it("returns 502 when chain tx fails", async () => {
    mockClient.logAction.mockRejectedValueOnce(new Error("RPC error"));
    const res = await request(app).post("/v1/audit").set(auth).send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/chain/i);
  });
});

// ─── GET /v1/audit/:agentId ───────────────────────────────────────────────────

describe("GET /v1/audit/:agentId", () => {
  it("returns audit trail with correct shape", async () => {
    const res = await request(app).get("/v1/audit/1").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.agent_id).toBe("1");
    expect(res.body.network).toBe("mantle");
    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].txHash).toBe("0xdeadbeef");
  });

  it("accepts ?network= query param", async () => {
    const res = await request(app).get("/v1/audit/1?network=arbitrum").set(auth);
    expect(getChainClient).toHaveBeenCalledWith("arbitrum");
    expect(res.status).toBe(200);
  });

  it("returns 400 for non-numeric agentId", async () => {
    const res = await request(app).get("/v1/audit/abc").set(auth);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown ?network= without touching the chain module", async () => {
    const res = await request(app).get("/v1/audit/1?network=ethereum").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("network must be one of: mantle, base, arbitrum, optimism, polygon");
    expect(getChainClient).not.toHaveBeenCalled();
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/v1/audit/1");
    expect(res.status).toBe(401);
  });

  it("returns 503 when network not configured", async () => {
    getChainClient.mockImplementationOnce((network: string) => {
      throw new NetworkNotConfiguredError(network);
    });
    const res = await request(app).get("/v1/audit/1?network=polygon").set(auth);
    expect(res.status).toBe(503);
  });
});

// ─── GET /v1/audit/:agentId/report ───────────────────────────────────────────

const AGENT_ADDR = "0x1111111111111111111111111111111111111111";
const UNREGISTERED = {
  registered: false,
  name: "",
  operator: "0x0000000000000000000000000000000000000000",
  createdAt: 0,
  complianceLevel: "",
  spendLimit: "0",
  revoked: false,
};

const article = (body: any, art: string) => body.evidence.find((e: any) => e.article === art);

/** Every key in a JSON value, recursively */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
  }
  return [];
}

function expectNoComplianceClaims(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/compliant/i); // also catches COMPLIANT / NON_COMPLIANT
  expect(json).not.toContain("compliance_status");
  expect(json).not.toMatch(/\bmet\b/i);
  expect(allKeys(body)).not.toContain("met");
}

describe("GET /v1/audit/:agentId/report", () => {
  afterEach(() => {
    mockClient.auditBatchAddress = "0x00000000000000000000000000000000000000Ab";
  });

  it("returns a v2 evidence report with disclaimer and all six Articles", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.report_version).toBe(2);
    expect(res.body.agent_id).toBe("1");
    expect(res.body.network).toBe("mantle");
    expect(res.body.disclaimer).toMatch(/does not determine/);
    expect(res.body.evidence.map((e: any) => e.article)).toEqual(
      ["Art. 12", "Art. 19", "Art. 26", "Art. 13", "Art. 9", "Art. 72"],
    );
    expect(res.body.eu_ai_act_compliance).toBeUndefined();
  });

  it("reports the registered agent with its self-declared tier", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.body.agent).toEqual({
      registered: true,
      name: "TestAgent",
      operator: "0x1234",
      registered_at: new Date(1700000000 * 1000).toISOString(),
      declared_risk_tier: "high",
      revoked: false,
    });
  });

  it("marks Art. 26 evidence_found for a registered agent", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    const a26 = article(res.body, "Art. 26");
    expect(a26.status).toBe("evidence_found");
    expect(a26.checks[0].source).toBe("AgentRegistration");
    expect(a26.checks[0].detail).toMatch(/agent #1 registered on mantle/);
    expect(a26.checks[0].detail).toMatch(/not revoked/);
  });

  it("keeps Art. 26 evidence_found for a revoked agent, with revoked:true and a note", async () => {
    mockClient.getAgentInfo.mockResolvedValueOnce({ ...registeredAgent, revoked: true });
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.body.agent.revoked).toBe(true);
    const a26 = article(res.body, "Art. 26");
    expect(a26.status).toBe("evidence_found");
    expect(a26.checks[0].detail).toMatch(/revoked by the operator/);
    expectNoComplianceClaims(res.body);
  });

  it("agent #0: registered:false and Art. 26 no_evidence", async () => {
    mockClient.getAgentInfo.mockResolvedValueOnce(UNREGISTERED);
    const res = await request(app).get("/v1/audit/0/report").set(auth);
    expect(res.status).toBe(200);
    expect(mockClient.getAgentInfo).toHaveBeenCalledWith(0);
    expect(res.body.agent.registered).toBe(false);
    expect(res.body.agent.name).toBeNull();
    const a26 = article(res.body, "Art. 26");
    expect(a26.status).toBe("no_evidence");
    expect(a26.checks.every((c: any) => c.status !== "evidence_found")).toBe(true);
  });

  it("non-existent agent id: registered:false and Art. 26 no_evidence", async () => {
    mockClient.getAgentInfo.mockResolvedValueOnce(UNREGISTERED);
    const res = await request(app).get("/v1/audit/999999/report").set(auth);
    expect(res.body.agent.registered).toBe(false);
    const a26 = article(res.body, "Art. 26");
    expect(a26.status).toBe("no_evidence");
    expect(a26.status).not.toBe("evidence_found");
    expect(a26.checks[0].detail).toMatch(/no AgentRegistration record for agent #999999/);
  });

  it("Art. 12/19: AgentAuditBatch events give evidence_found with last block", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    for (const art of ["Art. 12", "Art. 19"]) {
      const a = article(res.body, art);
      expect(a.status).toBe("evidence_found");
      const batch = a.checks.find((c: any) => c.source === "AgentAuditBatch");
      expect(batch.status).toBe("evidence_found");
      expect(batch.detail).toMatch(/1 AuditLogged events for agent #1 on mantle/);
      expect(batch.detail).toMatch(/submitter is not verified/);
      expect(batch.data.last_block).toBe(123);
    }
  });

  it("Art. 12/19: no_evidence when AgentAuditBatch has no events and no agent_address", async () => {
    mockClient.getAuditTrail.mockResolvedValueOnce([]);
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    const a12 = article(res.body, "Art. 12");
    expect(a12.status).toBe("no_evidence");
    expect(a12.checks.find((c: any) => c.source === "AgentAuditBatch").status).toBe("no_evidence");
  });

  it("Art. 12/19: not_checked when AgentAuditBatch is not configured and no agent_address", async () => {
    mockClient.auditBatchAddress = null;
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(200);
    expect(mockClient.getAuditTrail).not.toHaveBeenCalled();
    const a12 = article(res.body, "Art. 12");
    expect(a12.status).toBe("not_checked");
    const batch = a12.checks.find((c: any) => c.source === "AgentAuditBatch");
    expect(batch.status).toBe("not_checked");
    expect(batch.detail).toMatch(/AUDIT_BATCH_MANTLE not configured/);
  });

  it("AuditVault v2 check is not_checked without agent_address", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(mockVault.getBatchSummary).not.toHaveBeenCalled();
    const vault = article(res.body, "Art. 12").checks.find((c: any) => c.source === "AuditVault v2");
    expect(vault.status).toBe("not_checked");
    expect(vault.network).toBe("base");
    expect(vault.address).toBe("0xCeE831070aa9081422f30df5559c125aa47A75DB");
  });

  it("AuditVault v2 check with agent_address uses the caller-supplied wording", async () => {
    mockClient.auditBatchAddress = null;
    const res = await request(app).get(`/v1/audit/1/report?agent_address=${AGENT_ADDR}`).set(auth);
    expect(res.status).toBe(200);
    expect(mockVault.getBatchSummary).toHaveBeenCalledWith(AGENT_ADDR);
    const a12 = article(res.body, "Art. 12");
    expect(a12.status).toBe("evidence_found");
    const vault = a12.checks.find((c: any) => c.source === "AuditVault v2");
    expect(vault.status).toBe("evidence_found");
    expect(vault.detail).toBe(
      `3 batches recorded under the caller-supplied address ${AGENT_ADDR}; ` +
      "this address is not linked to agent #1 on-chain and the submitter is not verified (AuditVault v2)",
    );
    expect(vault.data).toEqual({
      batch_count: 3,
      last_batch_index: 2,
      last_block: 47100000,
      last_at: new Date(1780000000 * 1000).toISOString(),
    });
  });

  it("AuditVault v2 with zero batches is no_evidence", async () => {
    mockClient.auditBatchAddress = null;
    mockVault.getBatchSummary.mockResolvedValueOnce({
      vaultAddress: "0xCeE831070aa9081422f30df5559c125aa47A75DB",
      agentAddress: AGENT_ADDR,
      batchCount: 0,
      lastBatch: null,
    });
    const res = await request(app).get(`/v1/audit/1/report?agent_address=${AGENT_ADDR}`).set(auth);
    const a19 = article(res.body, "Art. 19");
    expect(a19.status).toBe("no_evidence");
    const vault = a19.checks.find((c: any) => c.source === "AuditVault v2");
    expect(vault.detail).toMatch(/^0 batches recorded under the caller-supplied address/);
    expect(vault.data.last_block).toBeNull();
  });

  it("returns 400 for an invalid agent_address", async () => {
    const res = await request(app).get("/v1/audit/1/report?agent_address=0x1234").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent_address/);
    expect(mockVault.getBatchSummary).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty agent_address", async () => {
    const res = await request(app).get("/v1/audit/1/report?agent_address=").set(auth);
    expect(res.status).toBe(400);
  });

  it("Art. 9, 13 and 72 are always not_checked; Art. 72 notes PostMarketMonitor is not deployed", async () => {
    const res = await request(app).get(`/v1/audit/1/report?agent_address=${AGENT_ADDR}`).set(auth);
    for (const art of ["Art. 9", "Art. 13", "Art. 72"]) {
      expect(article(res.body, art).status).toBe("not_checked");
      expect(article(res.body, art).checks).toEqual([]);
    }
    expect(article(res.body, "Art. 72").detail).toMatch(/PostMarketMonitor is not deployed/);
  });

  it("never contains met / COMPLIANT / compliant / compliance_status", async () => {
    const variants = [
      () => request(app).get("/v1/audit/1/report").set(auth),
      () => request(app).get(`/v1/audit/1/report?agent_address=${AGENT_ADDR}`).set(auth),
      () => {
        mockClient.getAgentInfo.mockResolvedValueOnce(UNREGISTERED);
        return request(app).get("/v1/audit/0/report").set(auth);
      },
      () => {
        mockClient.getAgentInfo.mockResolvedValueOnce({ ...registeredAgent, revoked: true, complianceLevel: "minimal" });
        return request(app).get("/v1/audit/1/report").set(auth);
      },
    ];
    for (const v of variants) {
      const res = await v();
      expect(res.status).toBe(200);
      expectNoComplianceClaims(res.body);
    }
  });

  it("returns 400 for non-numeric agentId", async () => {
    const res = await request(app).get("/v1/audit/abc/report").set(auth);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown ?network= without touching the chain module", async () => {
    const res = await request(app).get("/v1/audit/1/report?network=ethereum").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^network must be one of:/);
    expect(getChainClient).not.toHaveBeenCalled();
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/v1/audit/1/report");
    expect(res.status).toBe(401);
  });

  it("returns 503 when network not configured", async () => {
    getChainClient.mockImplementationOnce((network: string) => {
      throw new NetworkNotConfiguredError(network);
    });
    const res = await request(app).get("/v1/audit/1/report?network=optimism").set(auth);
    expect(res.status).toBe(503);
  });

  it("returns 503 on a malformed contract address", async () => {
    getChainClient.mockImplementationOnce(() => {
      throw new ContractConfigError("AUDIT_BATCH_MANTLE", "0xAF9ccA0C3D79900576557329F57824A0e277");
    });
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AUDIT_BATCH_MANTLE/);
  });

  it("returns 502 when a chain read fails", async () => {
    mockClient.getAgentInfo.mockRejectedValueOnce(new Error("RPC error"));
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/report/i);
  });
});

// ─── Every API response: no compliance verdict ──────────────────────────────

describe("every API response contains no met / COMPLIANT / compliant / compliance_status", () => {
  const body = {
    agent_id: "1",
    action: "transfer",
    decision: "approved",
    risk_level: "HIGH",
    network: "mantle",
    metadata: { amount: "100" },
  };
  const notConfigured = () =>
    getChainClient.mockImplementationOnce((network: string) => {
      throw new NetworkNotConfiguredError(network);
    });
  const malformed = () =>
    getChainClient.mockImplementationOnce(() => {
      throw new ContractConfigError("AUDIT_BATCH_MANTLE", "0xAF9ccA0C3D79900576557329F57824A0e277");
    });
  const unregistered = () =>
    mockClient.getAgentInfo.mockResolvedValueOnce({
      registered: false, name: "", operator: "0x0000000000000000000000000000000000000000",
      createdAt: 0, complianceLevel: "", spendLimit: "0", revoked: false,
    });

  const cases: Array<[string, number, () => any, (() => void)?]> = [
    ["GET /v1/health", 200, () => request(app).get("/v1/health")],
    ["POST /v1/audit HIGH", 201, () => request(app).post("/v1/audit").set(auth).send(body)],
    ["POST /v1/audit MEDIUM", 201, () => request(app).post("/v1/audit").set(auth).send({ ...body, risk_level: "MEDIUM" })],
    ["POST /v1/audit LOW", 201, () => request(app).post("/v1/audit").set(auth).send({ ...body, risk_level: "LOW" })],
    ["POST /v1/audit no auth", 401, () => request(app).post("/v1/audit").send(body)],
    ["POST /v1/audit wrong key", 401, () => request(app).post("/v1/audit").set("Authorization", "Bearer nope").send(body)],
    ["POST /v1/audit invalid body", 400, () => request(app).post("/v1/audit").set(auth).send({ ...body, risk_level: "CRITICAL" })],
    ["POST /v1/audit not configured", 503, () => request(app).post("/v1/audit").set(auth).send(body), notConfigured],
    ["POST /v1/audit malformed address", 503, () => request(app).post("/v1/audit").set(auth).send(body), malformed],
    ["POST /v1/audit no signing key", 503, () => request(app).post("/v1/audit").set(auth).send(body),
      () => mockClient.logAction.mockRejectedValueOnce(new SignerNotConfiguredError())],
    ["POST /v1/audit chain failure", 502, () => request(app).post("/v1/audit").set(auth).send(body),
      () => mockClient.logAction.mockRejectedValueOnce(new Error("RPC error"))],
    ["GET /v1/audit/1", 200, () => request(app).get("/v1/audit/1").set(auth)],
    ["GET /v1/audit/abc", 400, () => request(app).get("/v1/audit/abc").set(auth)],
    ["GET /v1/audit/1 unknown network", 400, () => request(app).get("/v1/audit/1?network=ethereum").set(auth)],
    ["GET /v1/audit/1 no auth", 401, () => request(app).get("/v1/audit/1")],
    ["GET /v1/audit/1 not configured", 503, () => request(app).get("/v1/audit/1").set(auth), notConfigured],
    ["GET /v1/audit/1 malformed address", 503, () => request(app).get("/v1/audit/1").set(auth), malformed],
    ["GET /v1/audit/1 chain failure", 502, () => request(app).get("/v1/audit/1").set(auth),
      () => mockClient.getAuditTrail.mockRejectedValueOnce(new Error("RPC error"))],
    ["GET report registered", 200, () => request(app).get("/v1/audit/1/report").set(auth)],
    ["GET report with agent_address", 200,
      () => request(app).get("/v1/audit/1/report?agent_address=0x1111111111111111111111111111111111111111").set(auth)],
    ["GET report agent #0", 200, () => request(app).get("/v1/audit/0/report").set(auth), unregistered],
    ["GET report non-existent id", 200, () => request(app).get("/v1/audit/999999/report").set(auth), unregistered],
    ["GET report revoked", 200, () => request(app).get("/v1/audit/1/report").set(auth),
      () => mockClient.getAgentInfo.mockResolvedValueOnce({ ...registeredAgent, revoked: true })],
    ["GET report AgentAuditBatch not configured", 200, () => request(app).get("/v1/audit/1/report").set(auth),
      () => { mockClient.auditBatchAddress = null; }],
    ["GET report no events", 200, () => request(app).get("/v1/audit/1/report").set(auth),
      () => mockClient.getAuditTrail.mockResolvedValueOnce([])],
    ["GET report bad agentId", 400, () => request(app).get("/v1/audit/abc/report").set(auth)],
    ["GET report unknown network", 400, () => request(app).get("/v1/audit/1/report?network=ethereum").set(auth)],
    ["GET report bad agent_address", 400, () => request(app).get("/v1/audit/1/report?agent_address=0x12").set(auth)],
    ["GET report no auth", 401, () => request(app).get("/v1/audit/1/report")],
    ["GET report not configured", 503, () => request(app).get("/v1/audit/1/report").set(auth), notConfigured],
    ["GET report malformed address", 503, () => request(app).get("/v1/audit/1/report").set(auth), malformed],
    ["GET report chain failure", 502, () => request(app).get("/v1/audit/1/report").set(auth),
      () => mockClient.getAgentInfo.mockRejectedValueOnce(new Error("RPC error"))],
    ["404", 404, () => request(app).get("/v1/unknown").set(auth)],
  ];

  afterEach(() => {
    mockClient.auditBatchAddress = "0x00000000000000000000000000000000000000Ab";
  });

  it.each(cases.map(([name, status, send, setup]) => ({ name, status, send, setup })))(
    "$name ($status)", async ({ status, send, setup }) => {
    setup?.();
    const res = await send();
    expect(res.status).toBe(status);
    expectNoClaimsStrict(res.body);
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

describe("404 handler", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/v1/unknown").set(auth);
    expect(res.status).toBe(404);
  });
});
