import request from "supertest";
import { createApp } from "../../src/api/app";

// Mock the chain module so tests never touch a real network
jest.mock("../../src/api/chain", () => {
  const mockClient = {
    logAction: jest.fn().mockResolvedValue("0xdeadbeefcafe"),
    getAuditTrail: jest.fn().mockResolvedValue([
      {
        agentId: "1",
        actionType: "transfer",
        payloadHash: "0xabc",
        timestamp: 1700000000,
        txHash: "0xdeadbeef",
      },
    ]),
    getAgentInfo: jest.fn().mockResolvedValue({
      name: "TestAgent",
      operator: "0x1234",
      createdAt: 1700000000,
      complianceLevel: "high",
      active: true,
      logCount: 1,
    }),
  };

  return {
    getChainClient: jest.fn().mockReturnValue(mockClient),
    NetworkNotConfiguredError: class NetworkNotConfiguredError extends Error {
      constructor(network: string) {
        super(`Contract addresses not configured for network: ${network}`);
        this.name = "NetworkNotConfiguredError";
      }
    },
    _mockClient: mockClient,
  };
});

const { getChainClient, _mockClient: mockClient, NetworkNotConfiguredError } = require("../../src/api/chain");

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

describe("GET /v1/audit/:agentId/report", () => {
  it("returns a compliance report with correct shape", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.agent_id).toBe("1");
    expect(res.body.agent.name).toBe("TestAgent");
    expect(res.body.agent.compliance_level).toBe("high");
    expect(res.body.eu_ai_act_compliance.applicable_articles).toContain("Art. 72");
    expect(res.body.eu_ai_act_compliance.compliance_status).toBe("COMPLIANT");
    expect(res.body.audit_summary.total_actions_logged).toBe(1);
  });

  it("marks revoked agent as NON_COMPLIANT", async () => {
    mockClient.getAgentInfo.mockResolvedValueOnce({
      name: "RevokedAgent",
      operator: "0x1234",
      createdAt: 1700000000,
      complianceLevel: "high",
      active: false,
      logCount: 5,
    });
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.body.eu_ai_act_compliance.compliance_status).toBe("NON_COMPLIANT");
  });

  it("returns 400 for non-numeric agentId", async () => {
    const res = await request(app).get("/v1/audit/abc/report").set(auth);
    expect(res.status).toBe(400);
  });

  it("returns 503 when network not configured", async () => {
    getChainClient.mockImplementationOnce((network: string) => {
      throw new NetworkNotConfiguredError(network);
    });
    const res = await request(app).get("/v1/audit/1/report?network=optimism").set(auth);
    expect(res.status).toBe(503);
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

describe("404 handler", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/v1/unknown").set(auth);
    expect(res.status).toBe(404);
  });
});
