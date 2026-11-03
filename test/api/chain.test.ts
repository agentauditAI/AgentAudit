import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";

// Real chain module (not mocked). Every case here fails on configuration before any RPC
// request is made; the RPC URLs point at a closed local port so a regression cannot reach
// a real network.
process.env.RPC_MANTLE = "http://127.0.0.1:1";
process.env.RPC_BASE = "http://127.0.0.1:1";
process.env.RPC_POLYGON = "http://127.0.0.1:1";

// require (not import) so the RPC env above is set before chain.ts reads it at load time
const { createApp } = require("../../src/api/app");
const {
  getChainClient,
  getBaseVaultAddress,
  NetworkNotConfiguredError,
  ContractConfigError,
} = require("../../src/api/chain");

const API_KEY = "test-api-key";
const auth = { Authorization: `Bearer ${API_KEY}` };
const MALFORMED = "0xAF9ccA0C3D79900576557329F57824A0e277"; // former Mantle default (36 hex)
const ENV_KEYS = ["AUDIT_BATCH_MANTLE", "REGISTRATION_MANTLE", "REGISTRATION_POLYGON", "AUDIT_VAULT_BASE"];

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  process.env.API_KEY = API_KEY;
  process.env.PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const { expectNoComplianceClaims } = require("./helpers/noComplianceClaims");
const createdApp = createApp();
// Every HTTP response in this file is also checked for compliance-verdict wording.
const app = {
  get: (path: string) => request(createdApp).get(path),
  post: (path: string) => request(createdApp).post(path),
};
async function send(r: any) {
  const res = await r;
  expectNoComplianceClaims(res.body);
  return res;
}
const validBody = {
  agent_id: "1",
  action: "transfer",
  decision: "approved",
  risk_level: "HIGH",
  network: "mantle",
};

describe("chain config: AgentAuditBatch has no default address", () => {
  it("exposes auditBatchAddress null on mantle when AUDIT_BATCH_MANTLE is unset", () => {
    const client = getChainClient("mantle");
    expect(client.auditBatchAddress).toBeNull();
    expect(client.registrationAddress).toBe("0x68769980879414e8f264Ac15a87813E2ABaBaD6e");
  });

  it("logAction rejects with a NetworkNotConfiguredError naming AUDIT_BATCH_MANTLE", async () => {
    const client = getChainClient("mantle");
    await expect(client.logAction(1, "x", "{}")).rejects.toBeInstanceOf(NetworkNotConfiguredError);
    await expect(client.logAction(1, "x", "{}")).rejects.toThrow(/AUDIT_BATCH_MANTLE/);
  });

  it("getAuditTrail rejects with a NetworkNotConfiguredError", async () => {
    const client = getChainClient("mantle");
    await expect(client.getAuditTrail(1)).rejects.toBeInstanceOf(NetworkNotConfiguredError);
  });

  it("POST /v1/audit on mantle returns 503 with a clear config message", async () => {
    const res = await send(app.post("/v1/audit").set(auth).send(validBody));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AgentAuditBatch address not configured for network: mantle/);
    expect(res.body.error).toMatch(/Set AUDIT_BATCH_MANTLE/);
  });

  it("GET /v1/audit/:agentId on mantle returns 503 with a clear config message", async () => {
    const res = await send(app.get("/v1/audit/1").set(auth));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AUDIT_BATCH_MANTLE/);
  });
});

describe("chain config: malformed addresses are explicit config errors", () => {
  it("throws ContractConfigError for the former malformed AUDIT_BATCH default", () => {
    process.env.AUDIT_BATCH_MANTLE = MALFORMED;
    expect(() => getChainClient("mantle")).toThrow(ContractConfigError);
    expect(() => getChainClient("mantle")).toThrow(/AUDIT_BATCH_MANTLE/);
  });

  it("throws ContractConfigError for a malformed REGISTRATION address", () => {
    process.env.REGISTRATION_MANTLE = "0x1234";
    expect(() => getChainClient("mantle")).toThrow(ContractConfigError);
  });

  it("POST /v1/audit returns 503 when AUDIT_BATCH_MANTLE is malformed", async () => {
    process.env.AUDIT_BATCH_MANTLE = MALFORMED;
    const res = await send(app.post("/v1/audit").set(auth).send(validBody));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(
      `Invalid contract address in AUDIT_BATCH_MANTLE: "${MALFORMED}" is not a valid EVM address.`,
    );
  });

  it("GET /v1/audit/:agentId/report returns 503 when AUDIT_BATCH_MANTLE is malformed", async () => {
    process.env.AUDIT_BATCH_MANTLE = MALFORMED;
    const res = await send(app.get("/v1/audit/1/report").set(auth));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AUDIT_BATCH_MANTLE/);
  });

  it("GET /v1/audit/:agentId/report returns 503 when AUDIT_VAULT_BASE is malformed", async () => {
    process.env.AUDIT_VAULT_BASE = "not-an-address";
    const res = await send(app.get("/v1/audit/1/report").set(auth));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AUDIT_VAULT_BASE/);
  });

  it("networks without a registration address still raise NetworkNotConfiguredError", () => {
    expect(() => getChainClient("polygon")).toThrow(NetworkNotConfiguredError);
  });
});

describe("chain config: Base AuditVault v2 address", () => {
  it("defaults to deployments/auditvault-base.json", () => {
    const deployed = JSON.parse(
      readFileSync(join(__dirname, "../../deployments/auditvault-base.json"), "utf8"),
    ).contracts.AuditVault;
    expect(getBaseVaultAddress()).toBe(deployed);
    expect(deployed).toBe("0xCeE831070aa9081422f30df5559c125aa47A75DB");
  });

  it("honours a valid AUDIT_VAULT_BASE override", () => {
    process.env.AUDIT_VAULT_BASE = "0x2222222222222222222222222222222222222222";
    expect(getBaseVaultAddress()).toBe("0x2222222222222222222222222222222222222222");
  });
});
