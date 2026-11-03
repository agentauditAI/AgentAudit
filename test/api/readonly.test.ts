import http from "http";
import { AddressInfo } from "net";
import request from "supertest";
import { AbiCoder, Interface, ZeroAddress } from "ethers";

// Read endpoints must work with no PRIVATE_KEY. This runs the real chain.ts against a local
// stub JSON-RPC server (no internet): it answers eth_chainId and eth_call for
// AgentRegistration.agents(uint256), and records every method it sees.

const REGISTRATION = "0x68769980879414e8f264Ac15a87813E2ABaBaD6e";
const AGENTS_SELECTOR = new Interface([
  "function agents(uint256) view returns (string,address,uint256,string,uint256,address,bool)",
]).getFunction("agents")!.selector;

const OPERATOR = "0x1111111111111111111111111111111111111111";
const methodsSeen: string[] = [];

function agentRecord(id: bigint): string {
  const coder = AbiCoder.defaultAbiCoder();
  const types = ["string", "address", "uint256", "string", "uint256", "address", "bool"];
  return id === 1n
    ? coder.encode(types, ["StubAgent", OPERATOR, 1700000000n, "high", 0n, ZeroAddress, false])
    : coder.encode(types, ["", ZeroAddress, 0n, "", 0n, ZeroAddress, false]);
}

function answer(req: { id: number; method: string; params?: any[] }) {
  methodsSeen.push(req.method);
  if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1388" };
  if (req.method === "eth_call") {
    const { to, data } = req.params![0];
    if (String(to).toLowerCase() === REGISTRATION.toLowerCase() && String(data).startsWith(AGENTS_SELECTOR)) {
      const id = BigInt("0x" + String(data).slice(10));
      return { jsonrpc: "2.0", id: req.id, result: agentRecord(id) };
    }
  }
  return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `stub: unsupported ${req.method}` } };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const out = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
});

const API_KEY = "test-api-key";
const auth = { Authorization: `Bearer ${API_KEY}` };
const ENV_KEYS = ["PRIVATE_KEY", "API_KEY", "RPC_MANTLE", "RPC_BASE", "AUDIT_BATCH_MANTLE", "REGISTRATION_MANTLE"];
const saved: Record<string, string | undefined> = {};
let app: any;
let expectNoComplianceClaims: (body: unknown) => void;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.API_KEY = API_KEY;
  process.env.RPC_MANTLE = url;
  process.env.RPC_BASE = url;
  // chain.ts reads RPC URLs at load time, so load it only now
  jest.isolateModules(() => {
    app = require("../../src/api/app").createApp();
  });
  expectNoComplianceClaims = require("./helpers/noComplianceClaims").expectNoComplianceClaims;
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("read endpoints without PRIVATE_KEY (real chain.ts, stub RPC)", () => {
  it("has no PRIVATE_KEY in the environment", () => {
    expect(process.env.PRIVATE_KEY).toBeUndefined();
  });

  it("GET /v1/audit/1/report returns 200 with the agent read from the chain", async () => {
    const res = await request(app).get("/v1/audit/1/report").set(auth);
    expect(res.status).toBe(200);
    expectNoComplianceClaims(res.body);
    expect(res.body.report_version).toBe(2);
    expect(res.body.agent.registered).toBe(true);
    expect(res.body.agent.name).toBe("StubAgent");
    expect(res.body.agent.operator).toBe(OPERATOR);
    expect(res.body.evidence.find((e: any) => e.article === "Art. 26").status).toBe("evidence_found");
  });

  it("GET /v1/audit/0/report reads an empty record as not registered", async () => {
    const res = await request(app).get("/v1/audit/0/report").set(auth);
    expect(res.status).toBe(200);
    expectNoComplianceClaims(res.body);
    expect(res.body.agent.registered).toBe(false);
    expect(res.body.evidence.find((e: any) => e.article === "Art. 26").status).toBe("no_evidence");
  });

  it("only read-only RPC methods were used (nothing signed or sent)", () => {
    expect(methodsSeen.length).toBeGreaterThan(0);
    expect(new Set(methodsSeen)).toEqual(new Set(["eth_chainId", "eth_call"]));
  });

  it("POST /v1/audit (write) still needs the key: 503 naming PRIVATE_KEY", async () => {
    process.env.AUDIT_BATCH_MANTLE = "0x3333333333333333333333333333333333333333";
    try {
      const res = await request(app).post("/v1/audit").set(auth).send({
        agent_id: "1", action: "transfer", decision: "approved", risk_level: "HIGH", network: "mantle",
      });
      expect(res.status).toBe(503);
      expectNoComplianceClaims(res.body);
      expect(res.body.error).toMatch(/set PRIVATE_KEY on the server/);
    } finally {
      delete process.env.AUDIT_BATCH_MANTLE;
    }
  });
});
