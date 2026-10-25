import { AgentAudit, createAgentAudit, NETWORKS, resolveBatchBuffer } from "../../sdk/src/index";

// anvil default account #0 — public test key
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const ENV_KEYS = ["AUDIT_PRIVATE_KEY", "AGENT_AUDIT_PRIVATE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("createAgentAudit", () => {
  it("reads AUDIT_PRIVATE_KEY", () => {
    process.env.AUDIT_PRIVATE_KEY = KEY;
    expect(createAgentAudit("base").getAddress()).toBe(ADDRESS);
  });

  it("accepts the deprecated AGENT_AUDIT_PRIVATE_KEY from the 1.0.x README", () => {
    process.env.AGENT_AUDIT_PRIVATE_KEY = KEY;
    expect(createAgentAudit("base").getAddress()).toBe(ADDRESS);
  });

  it("prefers AUDIT_PRIVATE_KEY when both are set", () => {
    process.env.AUDIT_PRIVATE_KEY = KEY;
    process.env.AGENT_AUDIT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    expect(createAgentAudit("base").getAddress()).toBe(ADDRESS);
  });

  it("throws when no key is set", () => {
    expect(() => createAgentAudit("base")).toThrow("AUDIT_PRIVATE_KEY env var required");
  });
});

describe("NETWORKS", () => {
  it("Base points at the verified AuditVault v2 deployment", () => {
    expect(NETWORKS.base.auditVault).toBe("0xCeE831070aa9081422f30df5559c125aa47A75DB");
    expect(NETWORKS.base.vaultVersion).toBe(2);
  });

  it("only Base is marked AuditVault v2; Arbitrum/Optimism/Polygon are not v2, Mantle is v1", () => {
    expect(NETWORKS.mantle.vaultVersion).toBe(1);
    expect(NETWORKS.arbitrum.vaultVersion).toBeNull();
    expect(NETWORKS.optimism.vaultVersion).toBeNull();
    expect(NETWORKS.polygon.vaultVersion).toBeNull();
  });
});

describe("batch anchoring availability", () => {
  const PARAMS = { agentAddress: ADDRESS, merkleRoot: "0x" + "11".repeat(32), contentURI: "x", eventCount: 1, complianceScore: 0 };

  it("commitBatch refuses Mantle (v1) with a clear error", async () => {
    const sdk = new AgentAudit({ privateKey: KEY, network: "mantle" });
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow(
      "Batch anchoring is not available on Mantle Mainnet: the default AuditVault (0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b) is AuditVault v1 and has no commitBatch"
    );
  });

  it.each([
    ["arbitrum", "Arbitrum One"],
    ["optimism", "Optimism Mainnet"],
    ["polygon", "Polygon Mainnet"],
  ] as const)("commitBatch refuses %s (not v2) with a clear error", async (network, name) => {
    const sdk = new AgentAudit({ privateKey: KEY, network });
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow(
      `Batch anchoring is not available on ${name}: the default AuditVault (${NETWORKS[network].auditVault}) is not AuditVault v2 and has no commitBatch`
    );
  });

  it("assertBatchAnchoring passes on Base and throws on non-v2 networks", () => {
    expect(() => new AgentAudit({ privateKey: KEY, network: "base" }).assertBatchAnchoring()).not.toThrow();
    expect(() => new AgentAudit({ privateKey: KEY, network: "arbitrum" }).assertBatchAnchoring()).toThrow(
      "Pass auditVaultAddress pointing at an AuditVault v2 deployment"
    );
  });

  it("auditVaultAddress override enables batch anchoring on any network", () => {
    const sdk = new AgentAudit({ privateKey: KEY, network: "polygon", auditVaultAddress: ADDRESS });
    expect(() => sdk.assertBatchAnchoring()).not.toThrow();
  });

  it("resolveBatchBuffer fails fast on a non-v2 network, works on Base", () => {
    expect(() => resolveBatchBuffer(new AgentAudit({ privateKey: KEY, network: "optimism" }))).toThrow(
      "Batch anchoring is not available on Optimism Mainnet"
    );
    expect(resolveBatchBuffer(new AgentAudit({ privateKey: KEY, network: "base" })).agentAddress).toBe(ADDRESS);
  });
});
