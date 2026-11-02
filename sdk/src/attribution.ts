// Base Builder Code attribution (ERC-8021 schema 0) for AgentAudit contract calls.
//
// What: a 29-byte suffix appended to the calldata of the SDK's own contract
// calls, on Base mainnet (8453) and Base Sepolia (84532) only. Contracts ignore
// trailing calldata; Base indexers read the code from the end of the calldata.
// The code is public on-chain. No audit evidence changes: action_ref, Merkle
// root, scope, contentURI and payload hashes are computed before the call is
// ABI-encoded, and the suffix goes after the encoding (only the tx hash differs).
//
// Opt out: `builderCode: false` (SDK) / AGENTAUDIT_BUILDER_CODE=false (MCP).
// Own code: `builderCode: "<your code>"`. See README "Base Builder Code attribution".
//
// The encoding is implemented here (no runtime dependency); test/sdk/attribution.test.ts
// checks it byte for byte against the ERC-8021 test vector and against `ox/erc8021`.

import { ethers } from "ethers";

/** AgentAudit's Base Builder Code, used unless the integrator passes `builderCode`. */
export const AGENTAUDIT_BUILDER_CODE = "bc_pd681w25";

/** Chains on which the suffix is appended: Base mainnet and Base Sepolia. */
export const BUILDER_CODE_CHAIN_IDS: readonly bigint[] = [8453n, 84532n];

/** ERC-8021 marker: 0x8021 repeated 8 times (16 bytes), at the very end of the calldata. */
export const ERC8021_MARKER = "0x80218021802180218021802180218021";

const SCHEMA_ID_0 = "00";
const MAX_CODES_LENGTH = 255; // codesLength is a single byte

/**
 * Checks a code against the ERC-8021 rules: non-empty, 7-bit ASCII, no comma
 * (0x2C, the delimiter), at most 255 bytes. Returns the code unchanged.
 */
export function validateBuilderCode(code: string): string {
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("Invalid builder code: must be a non-empty string");
  }
  if (!/^[\x00-\x7f]*$/.test(code)) {
    throw new Error(`Invalid builder code ${JSON.stringify(code)}: ERC-8021 codes are 7-bit ASCII`);
  }
  if (code.includes(",")) {
    throw new Error(`Invalid builder code ${JSON.stringify(code)}: ERC-8021 codes must not contain a comma`);
  }
  if (code.length > MAX_CODES_LENGTH) {
    throw new Error(`Invalid builder code: ${code.length} bytes, ERC-8021 allows at most ${MAX_CODES_LENGTH}`);
  }
  return code;
}

/**
 * ERC-8021 schema-0 data suffix: `codes ‖ codesLength (1 B) ‖ schemaId 0x00 ‖ 0x8021×8`,
 * where `codes` is the ASCII codes joined by commas.
 */
export function erc8021DataSuffix(codes: readonly string[]): string {
  if (codes.length === 0) throw new Error("ERC-8021 suffix needs at least one code");
  const joined = codes.map(validateBuilderCode).join(",");
  if (joined.length > MAX_CODES_LENGTH) {
    throw new Error(`ERC-8021 codes are ${joined.length} bytes with delimiters; at most ${MAX_CODES_LENGTH} allowed`);
  }
  const lengthByte = joined.length.toString(16).padStart(2, "0");
  return ethers.hexlify(ethers.toUtf8Bytes(joined)) + lengthByte + SCHEMA_ID_0 + ERC8021_MARKER.slice(2);
}

/**
 * Resolves the `builderCode` option: `undefined` → AgentAudit's code,
 * `false` → no attribution (`null`), a string → that code (validated).
 */
export function resolveBuilderCode(option: string | false | undefined): string | null {
  if (option === undefined) return AGENTAUDIT_BUILDER_CODE;
  if (option === false) return null;
  if (typeof option !== "string") {
    throw new Error("builderCode must be a string, false, or omitted");
  }
  return validateBuilderCode(option);
}

/**
 * Reads AGENTAUDIT_BUILDER_CODE semantics: unset or "" → `undefined` (default, on);
 * "false" / "off" / "0" (any case) → `false`; anything else → that string, to be
 * validated by `resolveBuilderCode`.
 */
export function builderCodeFromEnv(value: string | undefined): string | false | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^(false|off|0)$/i.test(v)) return false;
  return v;
}

/** The suffix for `chainId`: the code's ERC-8021 suffix on Base / Base Sepolia, else "0x". */
export function attributionSuffix(code: string | null, chainId: bigint): string {
  if (code === null || !BUILDER_CODE_CHAIN_IDS.includes(chainId)) return "0x";
  return erc8021DataSuffix([code]);
}

const chainIds = new WeakMap<ethers.Provider, Promise<bigint>>();

/**
 * The chain id the RPC actually reports (`provider.getNetwork()`), cached per
 * provider. A failed lookup is not cached. The configured network name is never used.
 */
export function providerChainId(provider: ethers.Provider): Promise<bigint> {
  let p = chainIds.get(provider);
  if (!p) {
    p = provider.getNetwork().then((n) => n.chainId);
    p.catch(() => chainIds.delete(provider));
    chainIds.set(provider, p);
  }
  return p;
}

/**
 * Sends `contract.method(...args)` like ethers' own contract call, with the
 * attribution suffix appended to the calldata when it applies. The signer
 * populates the final transaction, so gas is estimated on the calldata incl.
 * the suffix. Returns the same `ContractTransactionResponse` ethers would.
 */
export async function sendAttributed(
  contract: ethers.Contract,
  method: string,
  args: readonly unknown[],
  builderCode: string | null
): Promise<ethers.ContractTransactionResponse> {
  const signer = contract.runner as ethers.Signer | null;
  if (!signer || typeof signer.sendTransaction !== "function" || !signer.provider) {
    throw new Error("sendAttributed needs a contract connected to a signer with a provider");
  }
  const tx = await contract.getFunction(method).populateTransaction(...args);
  if (builderCode !== null) {
    const suffix = attributionSuffix(builderCode, await providerChainId(signer.provider));
    if (suffix !== "0x") tx.data = ethers.concat([tx.data, suffix]);
  }
  const sent = await signer.sendTransaction(tx);
  return new ethers.ContractTransactionResponse(contract.interface, signer.provider, sent);
}
