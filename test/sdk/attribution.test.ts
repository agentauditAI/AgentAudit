// Base Builder Code attribution (ERC-8021 schema 0) — sdk/src/attribution.ts and the
// AgentAudit send path. No network: the provider's getNetwork / sendTransaction are stubbed.

import { execFileSync } from "child_process";
import * as path from "path";
import { ethers } from "ethers";
import {
  AGENTAUDIT_BUILDER_CODE,
  AgentAudit,
  BUILDER_CODE_CHAIN_IDS,
  ERC8021_MARKER,
  attributionSuffix,
  builderCodeFromEnv,
  erc8021DataSuffix,
  providerChainId,
  resolveBuilderCode,
  validateBuilderCode,
} from "../../sdk/src/index";

// anvil default account #0 — public test key
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// bc_pd681w25 → "bc_pd681w25" (11 B ASCII) ‖ 0x0b ‖ 0x00 ‖ 0x8021×8
const OUR_SUFFIX = "0x62635f70643638317732350b0080218021802180218021802180218021";

function oxSuffixes(cases: string[][]): string[] {
  const helper = path.join(__dirname, "helpers", "ox-erc8021.mjs");
  return JSON.parse(execFileSync(process.execPath, [helper, JSON.stringify(cases)], { encoding: "utf8" }));
}

describe("erc8021DataSuffix (schema 0)", () => {
  it("AgentAudit's code bc_pd681w25 encodes to the exact spec bytes", () => {
    expect(AGENTAUDIT_BUILDER_CODE).toBe("bc_pd681w25");
    expect(erc8021DataSuffix(["bc_pd681w25"])).toBe(OUR_SUFFIX);
    const bytes = ethers.getBytes(OUR_SUFFIX);
    expect(bytes.length).toBe(29);
    expect(ethers.toUtf8String(bytes.slice(0, 11))).toBe("bc_pd681w25");
    expect(bytes[11]).toBe(11); // codesLength, after the codes
    expect(bytes[12]).toBe(0); // schemaId 0
    expect(ethers.hexlify(bytes.slice(13))).toBe(ERC8021_MARKER);
  });

  it("matches the ERC-8021 schema-0 test vector (txData 0xdddddddd, codes [baseapp])", () => {
    expect("0xdddddddd" + erc8021DataSuffix(["baseapp"]).slice(2)).toBe(
      "0xdddddddd62617365617070070080218021802180218021802180218021"
    );
  });

  it("matches the Base docs example for bc_b7k3p9da", () => {
    expect(erc8021DataSuffix(["bc_b7k3p9da"])).toBe("0x62635f62376b33703964610b0080218021802180218021802180218021");
  });

  it("matches ox/erc8021 Attribution.toDataSuffix byte for byte (devDependency cross-check)", () => {
    const cases = [
      ["bc_pd681w25"],
      ["baseapp"],
      ["bc_b7k3p9da"],
      ["baseapp", "morpho"],
      ["a"],
      ["x".repeat(255)],
      ["x".repeat(127), "y".repeat(127)],
      ["with space", "~!@#$%^&*()"],
    ];
    expect(oxSuffixes(cases)).toEqual(cases.map((c) => erc8021DataSuffix(c)));
  });

  it("joins multiple codes with commas; codesLength counts the delimiters", () => {
    const s = ethers.getBytes(erc8021DataSuffix(["baseapp", "morpho"]));
    expect(ethers.toUtf8String(s.slice(0, 14))).toBe("baseapp,morpho");
    expect(s[14]).toBe(14);
  });

  it.each([
    ["", /non-empty/],
    ["bc,evil", /comma/],
    ["bçode", /7-bit ASCII/],
    ["x".repeat(256), /at most 255/],
  ])("rejects invalid code %j", (code, msg) => {
    expect(() => validateBuilderCode(code)).toThrow(msg);
    expect(() => erc8021DataSuffix([code])).toThrow(msg);
  });

  it("rejects an empty code list and a joined length over 255", () => {
    expect(() => erc8021DataSuffix([])).toThrow(/at least one code/);
    expect(() => erc8021DataSuffix(["x".repeat(128), "y".repeat(127)])).toThrow(/256 bytes/);
  });

  it("does not enforce the bc_ format (ERC rules only)", () => {
    expect(validateBuilderCode("myapp")).toBe("myapp");
  });
});

describe("resolveBuilderCode / builderCodeFromEnv", () => {
  it("SDK option: omitted → AgentAudit's code, false → off, string → custom (validated)", () => {
    expect(resolveBuilderCode(undefined)).toBe("bc_pd681w25");
    expect(resolveBuilderCode(false)).toBeNull();
    expect(resolveBuilderCode("bc_custom1")).toBe("bc_custom1");
    expect(() => resolveBuilderCode("a,b")).toThrow(/comma/);
    expect(() => resolveBuilderCode("")).toThrow(/non-empty/);
    expect(() => resolveBuilderCode(true as any)).toThrow(/string, false, or omitted/);
  });

  it("env: unset or empty → default; false/off/0 (any case) → off; else custom", () => {
    expect(builderCodeFromEnv(undefined)).toBeUndefined();
    expect(builderCodeFromEnv("")).toBeUndefined();
    expect(builderCodeFromEnv("   ")).toBeUndefined();
    for (const off of ["false", "FALSE", "False", "off", "OFF", "0", " off "]) expect(builderCodeFromEnv(off)).toBe(false);
    expect(builderCodeFromEnv("bc_mine123")).toBe("bc_mine123");
    expect(builderCodeFromEnv(" bc_mine123 ")).toBe("bc_mine123");
    expect(builderCodeFromEnv("no")).toBe("no"); // only false/off/0 disable
  });
});

describe("attributionSuffix — Base mainnet and Base Sepolia only", () => {
  it("appends on 8453 and 84532", () => {
    expect(BUILDER_CODE_CHAIN_IDS).toEqual([8453n, 84532n]);
    expect(attributionSuffix("bc_pd681w25", 8453n)).toBe(OUR_SUFFIX);
    expect(attributionSuffix("bc_pd681w25", 84532n)).toBe(OUR_SUFFIX);
  });

  it.each([1n, 10n, 137n, 5000n, 42161n, 31337n, 11155111n])("never on chain %s", (chainId) => {
    expect(attributionSuffix("bc_pd681w25", chainId)).toBe("0x");
  });

  it("opt-out produces no suffix even on Base", () => {
    expect(attributionSuffix(null, 8453n)).toBe("0x");
  });

  it("custom code works", () => {
    expect(attributionSuffix("myapp", 8453n)).toBe(erc8021DataSuffix(["myapp"]));
  });
});

describe("providerChainId", () => {
  it("asks the RPC once per provider and caches the answer", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:1");
    const getNetwork = jest.spyOn(provider, "getNetwork").mockResolvedValue(new ethers.Network("x", 8453n));
    expect(await providerChainId(provider)).toBe(8453n);
    expect(await providerChainId(provider)).toBe(8453n);
    expect(getNetwork).toHaveBeenCalledTimes(1);
    provider.destroy();
  });

  it("does not cache a failed lookup", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:1");
    const getNetwork = jest.spyOn(provider, "getNetwork")
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValue(new ethers.Network("x", 84532n));
    await expect(providerChainId(provider)).rejects.toThrow("rpc down");
    expect(await providerChainId(provider)).toBe(84532n);
    expect(getNetwork).toHaveBeenCalledTimes(2);
    provider.destroy();
  });
});

// ─── AgentAudit send path ────────────────────────────────────────────────────

const V2_ABI = ["function commitBatch(address agentId, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore)"];
const PARAMS = { agentAddress: AGENT, merkleRoot: "0x" + "11".repeat(32), contentURI: "ipfs://x", eventCount: 3, complianceScore: 0 };
const PLAIN_DATA = new ethers.Interface(V2_ABI).encodeFunctionData("commitBatch", [
  PARAMS.agentAddress, PARAMS.merkleRoot, PARAMS.contentURI, PARAMS.eventCount, PARAMS.complianceScore,
]);

/** An SDK whose RPC reports `chainId`; sendTransaction captures the request and stops. */
function stubbed(chainId: bigint, config: Partial<ConstructorParameters<typeof AgentAudit>[0]> = {}) {
  const sdk = new AgentAudit({ privateKey: KEY, network: "base", ...config });
  const provider = (sdk as any).provider as ethers.JsonRpcProvider;
  const getNetwork = jest.spyOn(provider, "getNetwork").mockResolvedValue(new ethers.Network("stub", chainId));
  const sent: ethers.TransactionRequest[] = [];
  jest.spyOn((sdk as any).wallet as ethers.Wallet, "sendTransaction").mockImplementation(async (tx) => {
    sent.push(tx);
    throw new Error("captured");
  });
  return { sdk, provider, getNetwork, sent };
}

describe("AgentAudit — attribution on the send path", () => {
  afterEach(() => jest.restoreAllMocks());

  it("Base (8453): commitBatch calldata = ABI encoding ‖ bc_pd681w25 suffix", async () => {
    const { sdk, sent } = stubbed(8453n);
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(sent[0].data).toBe(PLAIN_DATA + OUR_SUFFIX.slice(2));
    expect(sent[0].to).toBe("0xCeE831070aa9081422f30df5559c125aa47A75DB");
  });

  it("Base Sepolia (84532) also gets the suffix", async () => {
    const { sdk, sent } = stubbed(84532n);
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(sent[0].data).toBe(PLAIN_DATA + OUR_SUFFIX.slice(2));
  });

  it.each([31337n, 1n, 10n, 5000n])("a 'base' config whose RPC reports chain %s gets no suffix", async (chainId) => {
    const { sdk, sent } = stubbed(chainId);
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(sent[0].data).toBe(PLAIN_DATA);
  });

  it("builderCode: false → no suffix on Base, and no chain lookup", async () => {
    const { sdk, sent, getNetwork } = stubbed(8453n, { builderCode: false });
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(sent[0].data).toBe(PLAIN_DATA);
    expect(getNetwork).not.toHaveBeenCalled();
    expect(sdk.getBuilderCode()).toBeNull();
    expect(await sdk.getAttributionSuffix()).toBe("0x");
  });

  it("custom builderCode is appended instead of AgentAudit's", async () => {
    const { sdk, sent } = stubbed(8453n, { builderCode: "myapp" });
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(sent[0].data).toBe(PLAIN_DATA + erc8021DataSuffix(["myapp"]).slice(2));
    expect(sdk.getBuilderCode()).toBe("myapp");
  });

  it("an invalid builderCode fails at construction", () => {
    expect(() => new AgentAudit({ privateKey: KEY, network: "base", builderCode: "a,b" })).toThrow(/comma/);
  });

  it("getAttributionSuffix reports the suffix for the RPC's chain; the chain id is cached per provider", async () => {
    const { sdk, getNetwork } = stubbed(8453n);
    expect(sdk.getBuilderCode()).toBe("bc_pd681w25");
    expect(await sdk.getAttributionSuffix()).toBe(OUR_SUFFIX);
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("captured");
    expect(getNetwork).toHaveBeenCalledTimes(1);
  });

  it("reportIncident (IncidentRegistry v2) carries the suffix too", async () => {
    const sel = (sig: string) => ethers.id(sig).slice(2, 10);
    const code = "0x" + ["registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256)", "markReportedToAuthority(uint256,address,string)", "incidents(uint256)"]
      .map((s) => "63" + sel(s)).join("");
    const { sdk, provider, sent } = stubbed(8453n);
    jest.spyOn(provider, "getCode").mockResolvedValue(code);
    await expect(sdk.reportIncident({ agentId: 1, severity: "HIGH", description: "x", occurredAt: 1 })).rejects.toThrow("captured");
    expect(sent[0].data!.startsWith("0x" + sel("registerIncident(bytes32,uint8,uint8,string,string,uint256,uint256)"))).toBe(true);
    expect(sent[0].data!.endsWith(OUR_SUFFIX.slice(2))).toBe(true);
  });

  it("gas is estimated on the final calldata (with suffix) by the signer", async () => {
    const sdk = new AgentAudit({ privateKey: KEY, network: "base" });
    const provider = (sdk as any).provider as ethers.JsonRpcProvider;
    jest.spyOn(provider, "getNetwork").mockResolvedValue(new ethers.Network("stub", 8453n));
    jest.spyOn(provider, "getTransactionCount").mockResolvedValue(0);
    const estimated: string[] = [];
    jest.spyOn(provider, "estimateGas").mockImplementation(async (tx) => {
      estimated.push(String(tx.data));
      throw new Error("estimated");
    });
    await expect(sdk.commitBatch(PARAMS)).rejects.toThrow("estimated");
    expect(estimated).toEqual([PLAIN_DATA + OUR_SUFFIX.slice(2)]);
  });
});
