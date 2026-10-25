import { AgentAudit, createAgentAudit, NETWORKS, resolveBatchBuffer } from "../../sdk/src/index";
import { ethers } from "ethers";

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

describe("IncidentRegistry v2 (Art. 73)", () => {
  const sel = (sig: string) => ethers.id(sig).slice(2, 10);
  const SIGS = [
    "registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256)",
    "markReportedToAuthority(uint256,address,string)",
    "incidents(uint256)",
  ];
  // Minimal "runtime code": each required selector as a PUSH4 immediate
  const V2_CODE = "0x" + SIGS.map((s) => "63" + sel(s)).join("");
  const REPORT = { agentId: 1, severity: "HIGH" as const, description: "x" };

  function withCode(code: string | (() => Promise<string>), config: Partial<ConstructorParameters<typeof AgentAudit>[0]> = {}) {
    const sdk = new AgentAudit({ privateKey: KEY, network: "base", ...config });
    const getCode = jest.spyOn((sdk as any).provider, "getCode")
      .mockImplementation(typeof code === "string" ? async () => code : code);
    return { sdk, getCode };
  }

  it("NETWORKS carries the verified per-network registry; Optimism has its own address", () => {
    for (const n of ["mantle", "base", "arbitrum", "polygon"] as const) {
      expect(NETWORKS[n].incidentRegistry).toBe("0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F");
    }
    expect(NETWORKS.optimism.incidentRegistry).toBe("0x976b03a2417cf7926813605F427ED499fdF61e10");
  });

  it("checks the network default address, once per instance", async () => {
    const { sdk, getCode } = withCode(V2_CODE, { network: "optimism" });
    await (sdk as any).incidentRegistry();
    await (sdk as any).incidentRegistry();
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(getCode).toHaveBeenCalledWith("0x976b03a2417cf7926813605F427ED499fdF61e10");
  });

  it("incidentRegistryAddress overrides the default", async () => {
    const override = "0x" + "12".repeat(20);
    const { sdk, getCode } = withCode(V2_CODE, { incidentRegistryAddress: override });
    expect(await (await (sdk as any).incidentRegistry()).getAddress()).toBe(ethers.getAddress(override));
    expect(getCode).toHaveBeenCalledWith(override);
  });

  it("throws a clear error when the address has no code, and caches it", async () => {
    const { sdk, getCode } = withCode("0x");
    const msg = "IncidentRegistry v2 is not available on Base Mainnet: 0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F has no contract code";
    await expect(sdk.reportIncident(REPORT)).rejects.toThrow(msg);
    await expect(sdk.getIncident(1)).rejects.toThrow(msg);
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("names the v2 functions a contract is missing (e.g. the old 5-arg registry)", async () => {
    const old5 = "0x63" + sel("registerIncident(bytes32,uint8,string,string,uint256)") + "63" + sel("incidents(uint256)");
    const { sdk } = withCode(old5);
    await expect(sdk.reportIncident(REPORT)).rejects.toThrow(
      "does not implement registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256), markReportedToAuthority(uint256,address,string)"
    );
  });

  it("does not cache RPC failures — the next call retries the check", async () => {
    let calls = 0;
    const { sdk, getCode } = withCode(async () => {
      if (calls++ === 0) throw new Error("rpc down");
      return V2_CODE;
    });
    await expect((sdk as any).incidentRegistry()).rejects.toThrow("rpc down");
    await expect((sdk as any).incidentRegistry()).resolves.toBeDefined();
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ severity: "SEVERE" }, "Invalid severity: SEVERE"],
    [{ harmType: "PAPERCUT" }, "Invalid harmType: PAPERCUT"],
    [{ affectedPersons: -1 }, "Invalid affectedPersons: -1"],
  ])("reportIncident rejects %o before any RPC", async (bad, msg) => {
    const { sdk, getCode } = withCode(V2_CODE);
    await expect(sdk.reportIncident({ ...REPORT, ...(bad as object) } as any)).rejects.toThrow(msg);
    expect(getCode).not.toHaveBeenCalled();
  });

  it("markReportedToAuthority rejects a non-address authority", async () => {
    const { sdk } = withCode(V2_CODE);
    await expect(sdk.markReportedToAuthority(1, { authority: "MSA-DE", authorityRef: "r" })).rejects.toThrow(/invalid address/);
  });

  it("agentId: bytes32 hex is used as-is, anything else is keccak256(String(id))", () => {
    const sdk = new AgentAudit({ privateKey: KEY, network: "base" });
    const raw = "0x" + "ab".repeat(32);
    expect((sdk as any).incidentAgentId(raw)).toBe(raw);
    expect((sdk as any).incidentAgentId(7)).toBe(ethers.id("7"));
    expect((sdk as any).incidentAgentId("0xabc")).toBe(ethers.id("0xabc"));
  });

  it("createAgentAudit ignores an empty AUDIT_INCIDENT_REGISTRY", () => {
    process.env.AUDIT_PRIVATE_KEY = KEY;
    const saved = process.env.AUDIT_INCIDENT_REGISTRY;
    process.env.AUDIT_INCIDENT_REGISTRY = "";
    expect((createAgentAudit("base") as any).config.incidentRegistryAddress).toBeUndefined();
    if (saved === undefined) delete process.env.AUDIT_INCIDENT_REGISTRY;
    else process.env.AUDIT_INCIDENT_REGISTRY = saved;
  });
});
