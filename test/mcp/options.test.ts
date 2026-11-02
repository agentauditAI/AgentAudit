// MCP server configuration: AGENTAUDIT_BUILDER_CODE (Base Builder Code, ERC-8021).
// Unset or "" → AgentAudit's code; "false" / "off" / "0" (any case) → off; else a custom code.

import { createServer, optionsFromEnv } from "../../src/mcp-server";

describe("optionsFromEnv — AGENTAUDIT_BUILDER_CODE", () => {
  it("unset or empty → builderCode undefined (attribution on, default code)", () => {
    expect(optionsFromEnv({}).builderCode).toBeUndefined();
    expect(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "" }).builderCode).toBeUndefined();
  });

  it.each(["false", "FALSE", "off", "Off", "0"])("%j → builderCode false", (v) => {
    expect(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: v }).builderCode).toBe(false);
  });

  it("any other value is the integrator's own code", () => {
    expect(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "bc_mine1234" }).builderCode).toBe("bc_mine1234");
  });

  it("keeps the other options as before", () => {
    const o = optionsFromEnv({ PRIVATE_KEY: "0xabc", RPC_BASE: "http://x", AUDIT_VAULT_BASE: "0x1" });
    expect(o).toEqual({ privateKey: "0xabc", rpcUrls: { base: "http://x" }, auditVaults: { base: "0x1" }, builderCode: undefined });
  });
});

describe("createServer — builder code validation", () => {
  it("rejects an invalid custom code at startup", () => {
    expect(() => createServer(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "a,b" }))).toThrow(/comma/);
    expect(() => createServer(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "bçode" }))).toThrow(/7-bit ASCII/);
  });

  it("starts with the default, a custom code, or attribution off", () => {
    expect(() => createServer(optionsFromEnv({}))).not.toThrow();
    expect(() => createServer(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "myapp" }))).not.toThrow();
    expect(() => createServer(optionsFromEnv({ AGENTAUDIT_BUILDER_CODE: "off" }))).not.toThrow();
  });
});
