/**
 * Generate fixtures/auditvault-v3/v1/eip712.json.
 *
 * Uses only ethers v6 (`TypedDataEncoder`, `SigningKey`), independent of the Solidity
 * implementation and of sdk/. Inputs are fixed; the signature is RFC 6979 deterministic.
 *
 * Usage (from the repo root):
 *   npx ts-node --transpile-only fixtures/auditvault-v3/v1/gen/gen_eip712.ts          # (re)write ../eip712.json
 *   npx ts-node --transpile-only fixtures/auditvault-v3/v1/gen/gen_eip712.ts --check  # exit 1 unless the file matches byte for byte
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { SigningKey, TypedDataEncoder, computeAddress, id, keccak256, sha256, toUtf8Bytes } from "ethers";

const OUT = join(__dirname, "..", "eip712.json");
const RFC6962 = join(__dirname, "..", "rfc6962.json");

// Anvil / Hardhat account #0: a public test key, never used for real funds.
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const domain = {
  name: "AgentAudit AuditVault",
  version: "3",
  chainId: 8453,
  // Address of the first CREATE from anvil account #0 (nonce 0); fixed, not a deployment.
  verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

const types = {
  Batch: [
    { name: "identityRegistry", type: "address" },
    { name: "agentId", type: "uint256" },
    { name: "seq", type: "uint64" },
    { name: "prevBatchHash", type: "bytes32" },
    { name: "root", type: "bytes32" },
    { name: "leafCount", type: "uint64" },
    { name: "rootFormat", type: "uint8" },
    { name: "metaHash", type: "bytes32" },
  ],
};

function build(): string {
  const tree3 = JSON.parse(readFileSync(RFC6962, "utf8")).trees.find((t: { n: number }) => t.n === 3);
  const metaPreimage = "auditvault-v3 fixture v1 batch 0";
  const batch = {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentId: "1",
    seq: "0",
    prevBatchHash: "0x" + "00".repeat(32),
    root: tree3.root as string,
    leafCount: "3",
    rootFormat: 0,
    metaHash: sha256(toUtf8Bytes(metaPreimage)),
  };

  const domainSeparator = TypedDataEncoder.hashDomain(domain);
  const structHash = TypedDataEncoder.hashStruct("Batch", types, batch);
  const batchHash = TypedDataEncoder.hash(domain, types, batch);

  const key = new SigningKey(ANVIL_KEY_0);
  const sig = key.sign(batchHash);

  const doc = {
    fixture: "auditvault-v3/v1/eip712",
    generator: "gen/gen_eip712.ts (ethers v6 TypedDataEncoder + SigningKey, independent of the Solidity implementation)",
    typehashes: {
      domain: id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      batch: id(TypedDataEncoder.from(types).encodeType("Batch")),
      batch_type: TypedDataEncoder.from(types).encodeType("Batch"),
      name_hash: keccak256(toUtf8Bytes(domain.name)),
      version_hash: keccak256(toUtf8Bytes(domain.version)),
    },
    domain,
    batch: { ...batch, metaHash_preimage_utf8: metaPreimage, root_source: "rfc6962.json trees[n=3].root" },
    domainSeparator,
    structHash,
    batchHash,
    signer: {
      note: "anvil/hardhat account #0 (public test key)",
      privateKey: ANVIL_KEY_0,
      address: computeAddress(key.publicKey),
    },
    signature: {
      serialized: sig.serialized,
      r: sig.r,
      s: sig.s,
      v: sig.v,
    },
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

const text = build();
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) {
    console.error("eip712.json does not match the generator output");
    process.exit(1);
  }
  console.log("eip712.json matches");
} else {
  writeFileSync(OUT, text);
  console.log("wrote eip712.json");
}
