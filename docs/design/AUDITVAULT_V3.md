# AuditVault v3 — Design Document

| | |
|---|---|
| Status | **Draft for review — §13 decisions recorded 2026-10-31.** Design only; no contract, deploy or SDK change is part of this document |
| Base commit | `main` @ `363ff7a` |
| Date | 2026-10-31 |
| Supersedes | nothing. AuditVault v2 stays live (§11) |
| EU AI Act | Supports, and provides evidence for: Art. 12 (record-keeping), Art. 19 (automatically generated logs), Art. 26 (deployer obligations: logs, identity of the deployed system). It does not by itself make any system compliant (§1) |
| Decisions | §13. All 15 design questions are **DECIDED**; non-blocking follow-ups are listed in §13.2 |

---

## 1. Goals and non-goals

### Goals

1. **Close KI-1** (`docs/THREAT_MODEL.md`). v2 `commitBatch` has no access control, so a batch under an agent address does not show who committed it. In v3, every batch is EIP-712-signed by the key that the canonical ERC-8004 IdentityRegistry authorizes for that agent, and the contract checks this at commit time.
2. **Close KI-2 (node-as-leaf).** v2 hashes leaves and internal nodes the same way and does not hash the leaf at all. v3 uses RFC 6962 domain separation (`0x00` for leaves, `0x01` for nodes), so no internal node can pass as a leaf.
3. **Per-agent continuity.** Each agent's batches form a hash chain (`seq`, `prevBatchHash`). A verifier holding batch *n* can detect a missing, reordered or substituted earlier batch, and the agent can openly declare a gap.
4. **Identity on a shared standard.** Agent = `(identityRegistry, agentId)` on the canonical ERC-8004 IdentityRegistry. v3 has no registration contract of its own.
5. **Immutable and minimal.** No admin, no pause, no proxy (§7).

### Non-goals

- **v3 is not a compliance determination.** It supports the record-keeping and logging obligations of Art. 12, 19 and 26, and provides evidence for them (authenticated, ordered, tamper-evident batch commitments). Whether a provider or deployer meets those Articles depends on what they log, how long they retain it, and their wider obligations, all outside v3.
- **v3 does not prove an agent logged everything.** A signed chain shows that the batches present were committed by the authorized key, in order, with no undeclared gap *between committed batches*. It cannot show that the agent put every action it took into a batch, or that it ever logged at all (withheld logging, §8.11).
- v3 does not prove that an off-chain action happened, or that the content behind `contentURI` is available. `metaHash` only binds the content once someone produces it.
- No compliance scoring on-chain. v2 `complianceScore` was self-reported and unauthenticated; **v3 drops it** (§13 Q11).
- No single-event fast path. v2 `commitHighRiskEvent` is **dropped**; a 1-leaf batch covers it (§13 Q12).
- No on-chain equivocation reporting in v3.0 (`reportEquivocation` is deferred to v3.1, §4.6).
- No changes to `action_ref` (`docs/EVIDENCE_SCHEMA.md` §1–2). Only the tree over the `action_ref`s and the anchoring change.

---

## 2. Identity

### 2.1 Canonical ERC-8004 IdentityRegistry, as deployed

Address **`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`**. Checked on 2026-10-31:

| Check | Base (8453) | Celo (42220) |
|---|---|---|
| `eth_getCode` | 130-byte ERC1967Proxy | 130-byte ERC1967Proxy |
| ERC-1967 implementation slot | `0x7274e874ca62410a93bd8bf61c69d8045e399c02` | same |
| ERC-1967 admin slot | `0` (UUPS) | `0` (UUPS) |
| Implementation runtime code SHA-256 | `201b7634af2de088c58868052856922ea8534c47e2837f19529460e2fafb4ff1` | identical |
| `owner()` (upgrade authority) | `0x547289319C3e6aedB179C0b8e8aF0B5ACd062603` | same |
| `name()` / `symbol()` | `AgentIdentity` / `AGENT` | same |
| Verified source | Basescan + Sourcify: `IdentityRegistryUpgradeable`, solc 0.8.24, `shanghai`, viaIR, 200 runs, OpenZeppelin (upgradeable) 5.4.0, exact match | Celoscan: same name, compiler and settings, exact match. Source text not fetched; equivalence rests on the identical runtime code hash |
| `getVersion()` | `"2.0.0"` | — |

Functions v3 depends on, copied from the verified source (not from memory):

| Purpose | Function | Behaviour relevant to v3 |
|---|---|---|
| Owner | `ownerOf(uint256 tokenId) → address` (OZ ERC721) | Reverts `ERC721NonexistentToken` for an unknown id |
| Agent wallet | `getAgentWallet(uint256 agentId) → address` | `address(bytes20(metadata[agentId]["agentWallet"]))`. Returns `0` when unset, and does **not** revert for an unknown id |
| Set wallet | `setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)` | Caller must be owner or approved. `newWallet` must sign EIP-712 `AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)` in domain `ERC8004IdentityRegistry` / `1`. ECDSA is tried first, then ERC-1271. Deadline ≤ 5 min ahead, no nonce |
| Unset wallet | `unsetAgentWallet(uint256 agentId)` | Owner or approved; sets the wallet to empty |
| Wallet on mint | `register()`, `register(string)`, `register(string, MetadataEntry[])` | Wallet starts as `msg.sender` |
| Wallet on transfer | `_update` override | **Clears `agentWallet`** on every transfer (not on mint or burn). Other metadata and the URI persist |
| Operators | `approve`, `getApproved`, `setApprovalForAll`, `isApprovedForAll` (OZ ERC721), `isAuthorizedOrOwner(address spender, uint256 agentId)` | Standard ERC-721. A transfer clears per-token approvals, not operator approvals |
| Metadata | `getMetadata(uint256 agentId, string metadataKey) → bytes`, `setMetadata(uint256, string, bytes)` (owner/approved; `"agentWallet"` reserved), `setAgentURI(uint256, string)`, `tokenURI(uint256)` | — |
| Events | `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`, `MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)`, `URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)`, plus ERC-721 `Transfer` / `Approval` / `ApprovalForAll` | Verifiers use `Transfer` and `MetadataSet("agentWallet")` to rebuild signer history |

Facts that shape the design:

- **Transferable, not soulbound.** Ownership changes during an agent's life are normal (§8.6).
- **Upgradeable by one key.** `_authorizeUpgrade` is `onlyOwner`. Making the registry address immutable in v3 does **not** make the registry's *behaviour* immutable (§8.9).
- **`agentId` is a per-chain counter.** The same `(registry, agentId)` on Base and on Celo are, in general, two unrelated agents. The EIP-712 `chainId` keeps them apart (§8.10).

### 2.2 Agent identity in v3

```
agent := (identityRegistry, agentId)       identityRegistry = immutable constructor argument
```

- `IDENTITY_REGISTRY` is set once in the constructor and cannot change. A deployment serves exactly one registry. Pointing at another registry needs another deployment.
- `identityRegistry` is still a signed field of `Batch` (§3). A signature is then explicitly bound to the registry, and an off-chain verifier never has to infer it from the vault address. The contract rejects `b.identityRegistry != IDENTITY_REGISTRY` (`WrongRegistry`).

### 2.3 Authorized signer — DECIDED (§13 Q1, Q2)

```
authorizedSigner(agentId) := wallet != 0 ? wallet : ownerOf(agentId)
    where wallet = IDENTITY_REGISTRY.getAgentWallet(agentId)
```

- The wallet is checked **first** because `getAgentWallet` does not revert for unknown ids. When it returns `0`, `ownerOf` reverts for a nonexistent agent. v3 catches that and reverts `UnknownAgent(agentId)`.
- **Exactly one signer at a time.** Owner and ERC-721 operators may *not* sign while a wallet is set; operators never sign. An owner who wants to sign can `unsetAgentWallet` or set the wallet to themselves.
- The check runs **at commit time** against the registry's live state. The signer used is recorded in storage and in the event (§6).

### 2.4 Signature check — DECIDED (§13 Q3): mirror the registry

v3 accepts a signature exactly when the registry's `setAgentWallet` would accept one from the same address: **ECDSA first, then ERC-1271**.

```
function _isValidSignature(address signer, bytes32 digest, bytes calldata sig) internal view returns (bool) {
    (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, sig);
    if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
    return SignatureChecker.isValidERC1271SignatureNow(signer, digest, sig);
}
```

**Does OZ 5.x `SignatureChecker.isValidSignatureNow` already do this? No, except in v5.0.0.** It was checked against the tagged sources on 2026-10-31:

| OZ tag | `isValidSignatureNow(address,bytes32,bytes)` |
|---|---|
| v5.0.0 | `tryRecover` matches **or** `isValidERC1271SignatureNow`, i.e. ECDSA first, then ERC-1271 (same as the registry) |
| v5.1.0, v5.4.0, v5.5.0, v5.7.0 (latest) | `signer.code.length == 0` → ECDSA only; otherwise → ERC-1271 only |

From v5.1.0 on, an EIP-7702-delegated EOA (its code is `0xef0100‖delegate`) is sent to ERC-1271 only. Its plain ECDSA signature, which the registry accepted when the wallet was set, would then be rejected unless the delegate implements ERC-1271. Pinning OZ v5.0.0 just to get the old behaviour would hold back every other dependency. So v3 **uses a current OZ (v5.7.0 at time of writing) and composes the two primitives itself**, as above. The ERC-1271 half *is* OZ `SignatureChecker.isValidERC1271SignatureNow`.

Equivalence with the registry, case by case:

- **ECDSA path:** both use OZ `ECDSA.tryRecover`, which rejects high-`s`, bad `v` and bad length (§8.3).
- **ERC-1271 path:** both make a `staticcall isValidSignature(digest, sig)`.
  - The registry requires `res.length >= 32 && abi.decode(res, (bytes4)) == 0x1626ba7e`.
  - OZ 5.7.0 requires `returndatasize() > 0x1f` and the first return word to equal the left-aligned selector.
  - These agree for every wallet that returns a properly ABI-encoded `bytes4`. A wallet returning dirty low-order bytes makes the registry revert (strict `abi.decode`) and OZ return `false`; either way the signature is not accepted.
- **Signer without code:** after a failed ECDSA check, the `staticcall` to a codeless address succeeds with empty return data, so OZ returns `false`, as the registry's `res.length >= 32` check does.

OZ v5.7.0's `isValidERC1271SignatureNow` uses `MCOPY`, which needs EVM ≥ cancun. The `prague` target (§9) covers it. OpenZeppelin is **not** vendored in `lib/` today; adding `lib/openzeppelin-contracts` at tag v5.7.0 is part of the implementation.

---

## 3. EIP-712

### 3.1 Domain

| Field | Value |
|---|---|
| `name` | `"AgentAudit AuditVault"` |
| `version` | `"3"` |
| `chainId` | `block.chainid` |
| `verifyingContract` | the v3 vault address |

No `salt`. Typehash and hashes:

```
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
  = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f
keccak256("AgentAudit AuditVault") = 0x63d42055ddacfa97712da5aaf9c6f50377d900c1f922dbf1ebb622c5cc1937d8
keccak256("3")                     = 0x2a80e1ef1d7842f27f2e6be0972bb708b9a135c38860dbe73c27c3486c34f4de
```

Implement it with OZ `EIP712` (caches the separator, recomputes it if `block.chainid` changes after a fork) and expose ERC-5267 `eip712Domain()`.

### 3.2 `Batch` struct — field widths DECIDED (§13 Q4)

```
Batch(address identityRegistry,uint256 agentId,uint64 seq,bytes32 prevBatchHash,bytes32 root,uint64 leafCount,uint8 rootFormat,bytes32 metaHash)
  = 0x7af2df7acacc5c264ef34182889651ddef0bcf2c042e0c9e022524e49e37cbdf
```

| Field | Type | Meaning |
|---|---|---|
| `identityRegistry` | `address` | Must equal `IDENTITY_REGISTRY` |
| `agentId` | `uint256` | ERC-8004 token id (the registry uses `uint256`) |
| `seq` | `uint64` | 0-based per-agent sequence number (§4) |
| `prevBatchHash` | `bytes32` | `batchHash` of batch `seq − 1`; `bytes32(0)` for `seq == 0` (§4.2) |
| `root` | `bytes32` | Merkle root (§5); `0` only for a declared gap (§4.4) |
| `leafCount` | `uint64` | Number of leaves; `0` only for a declared gap |
| `rootFormat` | `uint8` | `0` = RFC6962-SHA256, `1` = opaque/foreign root (§5.3) |
| `metaHash` | `bytes32` | Commitment to the off-chain batch payload (§6.3); for a gap, the reason code (§4.4) |

`uint64` for `seq` and `leafCount` costs nothing in EIP-712 (every field is a 32-byte word), and it lets `nextSeq` and per-batch block data pack into single storage slots.

```
structHash = keccak256(abi.encode(BATCH_TYPEHASH, identityRegistry, agentId, seq, prevBatchHash,
                                  root, leafCount, rootFormat, metaHash))
batchHash  = keccak256(0x1901 ‖ domainSeparator ‖ structHash)      // the EIP-712 digest
```

`batchHash` is the **full EIP-712 digest**, not the struct hash. A batch's identity therefore includes chain and vault, and the chain link in `prevBatchHash` cannot be satisfied by a batch from another deployment.

### 3.3 Relayer model

Anyone may submit. The signature authenticates the batch. `msg.sender` is irrelevant to authorization and is recorded only as `submitter` in the event, for gas accounting. Agents can keep keys off any gas-funded account, and a relayer cannot change any signed field.

### 3.4 Interface sketch (non-normative, for review only)

```
constructor(address identityRegistry)

function commitBatch(Batch calldata b, bytes calldata signature, string calldata contentURI)
    external returns (bytes32 batchHash);

function hashBatch(Batch calldata b) external view returns (bytes32);          // EIP-712 digest
function authorizedSigner(uint256 agentId) external view returns (address);
function nextSeq(uint256 agentId) external view returns (uint64);
function batchHashAt(uint256 agentId, uint64 seq) external view returns (bytes32); // 0 if not committed
function batchRecord(bytes32 batchHash) external view
    returns (address signer, uint64 blockNumber, uint32 timestamp);
function verifyInclusion(Batch calldata b, uint64 leafIndex, bytes32 actionRef, bytes32[] calldata proof)
    external view returns (bool);                                             // §5.5
function eip712Domain() external view returns (...);                           // ERC-5267

event BatchCommitted(
    uint256 indexed agentId, uint64 indexed seq, bytes32 indexed batchHash,
    bytes32 prevBatchHash, bytes32 root, uint64 leafCount, uint8 rootFormat, bytes32 metaHash,
    address signer, address submitter, string contentURI);

error WrongRegistry(address got);
error UnknownAgent(uint256 agentId);
error SeqMismatch(uint64 expected, uint64 got);
error PrevBatchHashMismatch(bytes32 expected, bytes32 got);
error InvalidSignature(address expectedSigner);
error UnknownRootFormat(uint8 rootFormat);
error EmptyBatch();                // root == 0 with leafCount != 0, or leafCount == 0 with root != 0
error InvalidGap(bytes32 metaHash); // §4.4 encoding violated
```

**`contentURI`: DECIDED (§13 Q5): unsigned and event-only.** It is a locator, and the content is authenticated by `metaHash`. A relayer that swaps the URI can make the content harder to find, but cannot make the batch verify against different content.

---

## 4. Continuity

### 4.1 Rules enforced by `commitBatch`

In this order (checks, effects, then the only external calls are `view`/`staticcall`):

1. `b.identityRegistry == IDENTITY_REGISTRY`, else `WrongRegistry`.
2. `b.rootFormat ∈ {0, 1}`, else `UnknownRootFormat`.
3. Shape: either `root != 0 && leafCount ≥ 1` (normal batch) or `root == 0 && leafCount == 0` (gap, §4.4). Anything else is `EmptyBatch` / `InvalidGap`.
4. `b.seq == nextSeq[agentId]`, else `SeqMismatch`.
5. `b.prevBatchHash == (seq == 0 ? bytes32(0) : batchHashAt[agentId][seq − 1])`, else `PrevBatchHashMismatch`.
6. `signer = authorizedSigner(agentId)`, which reverts `UnknownAgent` for an unknown id. Then `_isValidSignature(signer, batchHash, signature)` (§2.4), else `InvalidSignature(signer)`.
7. Effects: `nextSeq[agentId] = seq + 1`, `batchHashAt[agentId][seq] = batchHash`, `batchRecord[batchHash] = (signer, block.number, block.timestamp)`, emit `BatchCommitted`.

`seq` goes up by exactly 1, so at most one batch per `(agentId, seq)` can ever be committed in a deployment. `batchHashAt` makes that uniqueness directly readable.

### 4.2 Genesis — DECIDED (§13 Q8)

- The first batch of an agent has `seq = 0` and `prevBatchHash = bytes32(0)`.
- With nothing stored, `nextSeq` is `0` and the expected previous hash is `bytes32(0)`, so genesis needs no special storage.
- Genesis is per `(deployment, agentId)`. A transfer of the agent NFT does **not** restart the chain (§4.7).

### 4.3 Chain verification (off-chain)

A verifier checking batch `n` of agent `A`:
1. Fetches all `BatchCommitted(agentId = A)` events from the deployment block, ordered by `seq` (or reads `batchHashAt(A, 0…n)`).
2. Checks `seq` runs 0…n without holes, and each `prevBatchHash` equals the previous event's `batchHash`.
3. Recomputes each `batchHash` from the event fields and checks it equals the indexed `batchHash`, `batchHashAt` and `batchRecord`.

On-chain enforcement makes step 2 redundant within one deployment. It is still the check that catches a lying RPC or indexer.

### 4.4 Declared gap batch — DECIDED (§13 Q7)

An agent that knows it lost or did not record a period (outage, pipeline failure, key compromise, §8.7) commits a **gap batch** to keep the chain honest:

| Field | Gap value |
|---|---|
| `root` | `0` |
| `leafCount` | `0` |
| `rootFormat` | `0` |
| `metaHash` | `bytes32(uint256(reasonCode))`, `reasonCode ∈ [1, 65535]`, upper 240 bits zero |

The contract enforces `reasonCode != 0` and the zero upper bits (`InvalidGap`). It does **not** check that the code is listed below, so new codes need no redeploy.

**Reason-code registry (maintained in this document):**

| Code | Name | Meaning |
|---|---|---|
| `1` | `AGENT_OFFLINE` | Agent was not running; no actions expected for the period |
| `2` | `PIPELINE_FAILURE` | Agent ran, but logging or anchoring failed; actions in the period are unlogged |
| `3` | `KEY_COMPROMISE` | Signer key was or may have been compromised; earlier batches back to the last trusted `seq` are suspect (§8.7) |
| `4` | `DATA_LOSS` | Off-chain batch payloads were lost; on-chain roots remain, content does not |
| `5`–`65534` | reserved | Assigned only by amending this table |
| `65535` | `OTHER` | See the document behind `contentURI` |

Rules for the registry: codes are never reused or renumbered. A new code is added by a doc PR before any SDK emits it. Verifiers display unknown codes as `UNKNOWN(<n>)`, never as an error.

Trade-off accepted: the code is on-chain and signed, but a gap's free-text explanation behind `contentURI` is **not** authenticated.

A gap batch takes a `seq` like any other batch, so the chain stays unbroken. It is a statement that something is missing, not a proof of what.

### 4.5 What continuity shows

- **Shows:** between two committed batches of the same agent there is no hidden batch. The authorized signer at each step chose this order.
- **Does not show:** that nothing happened between batches without being logged (§1 non-goals). Nor that the most recent committed batch is the last one the agent *will* commit. Truncation of the tail is only visible as "no new batch since block T".

### 4.6 Equivocation

Equivocation = two different valid signatures over two different `Batch` structs with the same `(chainId, vault, agentId, seq)`.

- **On-chain, inside one deployment, it cannot happen.** Step 4 accepts only one batch per `seq`.
- **Off-chain, it can.** The key can sign a second, conflicting batch and give it to a counterparty (e.g. to show a different history). Such a pair is self-contained **evidence of key misuse**: anyone can check both signatures against `authorizedSigner` at the relevant block.
- **v3.0 documents it only.** The verifier should report an equivocation if given two conflicting signed batches. `reportEquivocation(Batch a, bytes sigA, Batch b, bytes sigB)`, which would record proof on-chain and possibly freeze the agent's chain, is **deferred to v3.1**. Freezing raises authority questions that conflict with §7.

### 4.7 Ownership change — DECIDED (§13 Q14)

The chain continues across owners; there is no reset. Each batch's signer is recorded at commit time (`batchRecord`, `BatchCommitted.signer`), so a change of signer is visible to verifiers. They also see the registry `Transfer` / `MetadataSet("agentWallet")` events. Pre-transfer batches keep their recorded signer.

---

## 5. Merkle tree

### 5.1 Construction (rootFormat 0): RFC 6962 §2.1 with SHA-256

```
MTH({})        — not allowed in v3 (an empty batch is a gap, §4.4)
MTH({d0})      = SHA-256(0x00 ‖ d0)
MTH(D[n]), n>1 = SHA-256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n]))
                 where k = largest power of two < n
```

- **Leaf data `d_i` = `action_ref_i` (32 bytes)**, in insertion order, with `action_ref = SHA-256(JCS(preimage))` unchanged from `docs/EVIDENCE_SCHEMA.md` §1. The leaf hash is therefore `SHA-256(0x00 ‖ action_ref)`, 33 bytes in.
- Pairs are **ordered** (left ‖ right), not sorted.
- Inclusion proof = RFC 6962 §2.1.1 audit path, verified with `(leaf_index, tree_size = leafCount, path)` as in RFC 9162 §2.1.3.2 (§5.5).
- The `0x00`/`0x01` prefixes make an internal node (`SHA-256(0x01‖…)`) impossible to present as a leaf hash (`SHA-256(0x00‖…)`) without a SHA-256 preimage collision. That is what closes **KI-2**. A verifier must still recompute `action_ref` from the preimage; that rule stays (it proves the leaf is a real action, not just a real leaf).

### 5.2 Informative vectors (to be cross-checked)

Computed with a 15-line Python reference (`hashlib.sha256`). Leaves are `L_i = bytes([i]) * 32`, i.e. `0x0101…01`, `0x0202…02`, …

| n | leaves | root |
|---|---|---|
| 1 | L1 | `dcffe786ded16d283c663846ad0c4ff26558fccde36ca9d30b2ea19eade9fc0e` |
| 2 | L1–L2 | `3a066e0f40c6a1981ebfa60d2411625d0517ae22c2fc8c7c1784ff8a75c78565` |
| 3 | L1–L3 | `df896896c799531f1fd1e556cea26a6989ab06853bcbfdd3e4f5097a611f658f` |
| 4 | L1–L4 | `3b3c0ce45d11517a54300a196b61497c4165150d72b7782a4548e3984da771b2` |
| 5 | L1–L5 | `c51042bb8b9d81dfc115ef99d0e2cecf1954cfc078d70032d187b46615f01b90` |
| 7 | L1–L7 | `a01b0568e97f4a883e53549ff9e936845853334158de367ad483d981b3142f4a` |

Single leaf = the EVIDENCE_SCHEMA §1.2 example `action_ref 0x42de5e…fdad` gives root `7e8c9648bc663aa608626a5cebfa3f0ceda48dcde9ea35107572a484d93a0679` (≠ the `action_ref`, unlike v2).

These are **not normative**. The normative vectors go in `fixtures/auditvault-v3/v1/` (§11.4), and are cross-checked against an independent RFC 6962 implementation (§12).

### 5.3 rootFormat

| Value | Name | Meaning | Verifier behaviour |
|---|---|---|---|
| `0` | `RFC6962-SHA256` | §5.1 over `action_ref` leaves | Recompute root and inclusion proofs |
| `1` | opaque / foreign | 32-byte root of some other construction, e.g. MnemoPay `ChainBundle` (`sha256Hex(hexA + hexB)` over ASCII hex, odd node duplicated) | v3 authenticates and orders the root. Inclusion is the foreign system's job; the verifier must not apply §5.1 |
| `2–255` | reserved | — | `commitBatch` reverts `UnknownRootFormat` |

The contract does not and cannot verify that `root` matches `leafCount` or `rootFormat`. It verifies only who signed them.

### 5.4 v2 vs v3, and what breaks

v2 (contract `_verifyMerkle`, `sdk/src/batch.ts`, `tools/verify`): leaf = `action_ref` unhashed; node = `keccak256(min(a,b) ‖ max(a,b))`; an odd last node is promoted unchanged; a single leaf gives root == leaf; proofs carry no index.

**Tree shape is the same.** Bottom-up pairing with odd-node promotion produces exactly the RFC 6962 "largest power of two" split. This was checked mechanically for every n = 1…1024 by comparing both constructions with identical hash functions. Every other part changes:

| Aspect | v2 | v3 (rootFormat 0) | Effect |
|---|---|---|---|
| Leaf hash | `action_ref` | `SHA-256(0x00 ‖ action_ref)` | Every root changes |
| Node hash | `keccak256`, sorted pair | `SHA-256(0x01 ‖ left ‖ right)`, ordered | Every root changes; v2 proofs are invalid in v3 |
| Proof input | `(leaf, path)` | `(leaf, leaf_index, tree_size, path)` | Proof format and verifier API change |
| On-chain proof check | `verifyLog(address, batchIndex, leaf, proof)` | `verifyInclusion(Batch, leafIndex, actionRef, proof)` (§5.5) | New signature; takes the whole `Batch` because `root` is not stored |
| 1-leaf batch | root == `action_ref` (`commitHighRiskEvent`) | root = `SHA-256(0x00‖action_ref)` via normal `commitBatch` | "root is the action" shortcut and `commitHighRiskEvent` are gone (§13 Q12) |
| Agent key | `address agentId`, unauthenticated | `(registry, uint256 agentId)` | SDK/MCP `agentId` handling changes |
| Write call | `commitBatch(address,bytes32,string,uint256,uint8)` | `commitBatch(Batch,bytes,string)` | New ABI; no `complianceScore` |
| Event | `LogBatchCommitted` | `BatchCommitted` (§3.4) | Indexers, `tools/verify`, `mnemopay-anchor` status lookup |
| Stored per batch | full `LogBatch` incl. `contentURI` string, score | `batchHashAt(agentId, seq)` + `batchRecord(batchHash)` | `getBatch` / `getAllBatches` / `getLatestComplianceScore` / `registerAgent` do not exist |
| Batch payload | `schema: "agentaudit-evidence-v1"`, `leaf_hash: "sha256(jcs(preimage))"`, `node_hash: "keccak256(sorted_pair)"`, `odd_node: "promote"` | `schema: "agentaudit-batch-v3"` (§11.3) | A v2 verifier rejects a v3 payload at `bundle.schema` instead of misreading it |

**Unchanged:** `action_ref`, JCS, preimage fields, scope commitment formats (`docs/EVIDENCE_SCHEMA.md` §1–2), and every existing fixture and hash.

### 5.5 `verifyInclusion` — DECIDED (§13 Q5)

```
verifyInclusion(Batch b, uint64 leafIndex, bytes32 actionRef, bytes32[] proof) → bool
```

Returns `true` only if **all** hold:
1. `batchRecord[hashBatch(b)]` exists. The batch was committed in this deployment, so `root` / `leafCount` are the signed ones.
2. `b.rootFormat == 0` and `b.leafCount ≥ 1` (gaps and foreign roots → `false`).
3. The RFC 9162 §2.1.3.2 check over `leaf = SHA-256(0x00 ‖ actionRef)`:

```
if leafIndex >= leafCount: return false
fn = leafIndex; sn = leafCount - 1; r = SHA-256(0x00 ‖ actionRef)
for p in proof:
    if sn == 0: return false
    if (fn & 1) == 1 or fn == sn:
        r = SHA-256(0x01 ‖ p ‖ r)
        if (fn & 1) == 0:
            while (fn & 1) == 0 and fn != 0: fn >>= 1; sn >>= 1
    else:
        r = SHA-256(0x01 ‖ r ‖ p)
    fn >>= 1; sn >>= 1
return sn == 0 and r == b.root
```

- It takes `actionRef` (leaf *data*) and does the `0x00` hashing itself, so a caller cannot present an internal node as a leaf.
- It returns `false` rather than reverting, like v2 `verifyLog`.
- The algorithm was checked against an independent Python implementation of RFC 6962 §2.1.1 audit paths for every leaf of every tree with n = 1…129. All valid proofs pass. Truncated proofs, wrong indices and internal-node-as-leaf attempts all fail.
- Cost: one SHA-256 precompile call per proof element (60 + 12 per word, ≈ 84 gas for 64 bytes plus call overhead), ⌈log₂ n⌉ elements.
- `verifyInclusion == true` proves that `actionRef` is leaf `leafIndex` of a committed, authenticated batch. It still does not prove that `actionRef` is the hash of a real preimage; verifiers recompute it (§5.1).

---

## 6. Storage, events, gas

### 6.1 Storage — DECIDED (§13 Q6)

```
mapping(uint256 agentId  => uint64)                     nextSeq;      // 1 slot per agent
mapping(uint256 agentId  => mapping(uint64 => bytes32)) batchHashAt;  // 1 slot per batch
mapping(bytes32 batchHash => Record)                    batchRecord;  // { address signer; uint64 blockNumber; uint32 timestamp; }  1 slot per batch
```

- `nextSeq` + `batchHashAt` are the per-agent chain. The expected `prevBatchHash` is `batchHashAt[agentId][seq − 1]`, so no separate "last hash" slot is stored. `batchHashAt` makes `(agentId, seq)` lookups and per-`seq` uniqueness a single read.
- `batchRecord` answers "was this exact batch committed, when, and with which signer?" with one `eth_call`, without log queries. The **signer is the one resolved at commit time**, which may differ from today's wallet or owner.
- Everything else (`root`, `leafCount`, `metaHash`, `contentURI`, `submitter`) lives **only in the event**. Root, count and meta are also covered by `batchHash`, so a verifier holding the event fields (or the `Batch` passed to `verifyInclusion`) can confirm them against `batchRecord`.
- Not stored: `contentURI` strings, per-agent arrays, totals, compliance scores.

### 6.2 Gas estimate on Base (estimate; to be replaced by `forge test --gas-report`)

Per `commitBatch`, steady state (agent already has batches), EOA signer, ~100-byte `contentURI`:

| Item | ≈ gas |
|---|---|
| Intrinsic | 21 000 |
| Calldata (~550 B: 8-word struct, 65-B signature, URI, ABI offsets) | 6 000 – 9 000 |
| `getAgentWallet` (cold proxy + cold implementation + cold slot) | 8 000 |
| `ownerOf` (only when wallet unset; warm proxy) | 3 000 |
| EIP-712 hashing + `ecrecover` | 4 500 |
| `nextSeq` read + update (non-zero → non-zero) | 5 000 |
| `batchHashAt[seq − 1]` read (cold) | 2 100 |
| `batchHashAt[seq]` new slot (zero → non-zero) | 22 100 |
| `batchRecord` new slot (zero → non-zero) | 22 100 |
| `BatchCommitted` (4 topics, ~350 B data) | 5 000 |
| **Total** | **≈ 96 000 – 102 000** |

- First batch of an agent: `nextSeq` goes zero → non-zero (+17 100) and there is no previous-hash read (−2 100), about **+15 000**.
- ERC-1271 signers add one failed `ecrecover` plus the wallet's `isValidSignature` cost, which is unbounded and wallet-specific.
- On 2026-10-31, Base block 53 339 608 had a base fee of 0.005 gwei, so L2 execution is ≈ 5 × 10⁻⁷ ETH per batch. **On Base the L1 data fee usually dominates.** It scales with compressed calldata size, so measure it with the GasPriceOracle on Base Sepolia before quoting a price. Celo is measured separately on Celo Sepolia.

### 6.3 `metaHash`

`metaHash = SHA-256(JCS(payload))`, where `payload` is the v3 batch payload document (§11.3) **without** the fields that depend on the anchor (`anchor`, `signature`, `batch_hash`). The payload contains the `action_ref`s and preimages, so `metaHash` binds the off-chain content to the signed batch. For `rootFormat 1`, the foreign system's bundle (e.g. MnemoPay `ChainBundle` JCS) takes the place of the payload. For gap batches, see §4.4.

### 6.4 Verifiers check authorization at the commit block — DECIDED (§13 Q9)

Two layers, both required:

1. **On-chain, at commit time.** The contract resolves the signer against the registry's live state and records it in `batchRecord` and the event.
2. **Off-chain, by the verifier.** Authorization was enforced at commit, but an independent verifier should not take that on trust from an RPC. It must also **not** check against current registry state: wallets rotate and agents are transferred legitimately. The verifier:
   1. Gets the commit block `N` (receipt or `batchRecord.blockNumber`) and the recorded `signer`.
   2. Checks the signature over the recomputed `batchHash` with the §2.4 rule → must equal `signer`.
   3. Calls `getAgentWallet(agentId)` / `ownerOf(agentId)` with `blockTag = N` (archive node) and confirms `signer` is the authorized one by the §2.3 rule.

      Caveat: `eth_call` at block `N` sees the state **after** all of `N`'s transactions. If the wallet changed in the same block, the result can differ. In that case the verifier checks state at `N − 1` and replays the registry events in block `N` up to the commit's transaction index. Otherwise it reports `INCONCLUSIVE`, not `FAIL`.
   4. Reads the registry's ERC-1967 implementation slot (`0x360894a1…382bbc`) at block `N` with `eth_getStorageAt` and checks it against a list of known-good implementations. That list starts with `0x7274e874…9c02` on Base and Celo and ships with `tools/verify`. Any other value → `UNTRUSTED_REGISTRY` (§8.9).

---

## 7. No admin, no pause, no proxy

- **No owner or admin role.** There is nothing to administer: the registry address is immutable, and authorization is fully delegated to ERC-8004. An admin key would bring back exactly the "someone other than the agent can shape the log" property that v3 exists to remove.
- **No pause.** A pause would let one key censor every agent's logging, which also makes it a single point of legal pressure. An agent that must stop logging can simply stop, or declare a gap.
- **No proxy / upgrade.** A log whose verification rules can change after the fact is weaker evidence. A bug fix means a new deployment (v3.1, v4) plus a migration note, exactly like v2 → v3. The registry itself *is* upgradeable; that is the registry's risk, handled in §8.9, and not one to copy.
- Consequences: a bug in v3 cannot be patched in place. The pre-deploy bar is high: §12 test plan, an external review, a fixed compiler (§9), and a testnet soak on Base Sepolia and Celo Sepolia.

---

## 8. Threat model delta

| # | Threat | v2 | v3 |
|---|---|---|---|
| 8.1 | **Forgery**: committing under someone else's agent | Possible (KI-1) | Needs a valid signature from `authorizedSigner(agentId)` at commit time |
| 8.2a | **Replay** across chains | n/a (no signatures) | `chainId` in the domain. The same `agentId` on Base and Celo signs different digests |
| 8.2b | **Replay** across contracts | n/a | `verifyingContract` in the domain; `identityRegistry` in the struct |
| 8.2c | **Replay** in the same contract | n/a | `seq` must equal `nextSeq`, so a resubmitted batch fails `SeqMismatch` |
| 8.3 | **Signature malleability** | n/a | OZ ECDSA rejects high-`s`. Nothing is keyed by signature bytes (only by `batchHash`), so even a malleable ERC-1271 signature cannot create a second record |
| 8.4 | **Front-running** a signed batch from the mempool | Anyone could commit anything | A copier can only submit the identical batch. The result is the same state; the original transaction reverts `SeqMismatch` (relayer gas loss only). `contentURI` can be swapped (§3.4) but `metaHash` binds the content |
| 8.5 | **Node-as-leaf** | Possible (KI-2) | Prevented by RFC 6962 `0x00`/`0x01` prefixes; `verifyInclusion` hashes the leaf itself |
| 8.6 | **Ownership transfer** mid-chain | n/a | The chain continues under the new owner (§4.7). The registry clears `agentWallet` on transfer, so the signer falls back to the new owner. Batches signed by the old wallet but not yet submitted can no longer be committed. Pre-transfer batches keep their recorded signer |
| 8.7 | **Compromised agent key** | n/a | The attacker can append batches (and use up `seq`s) until rotation. Rotation: the owner calls `setAgentWallet` (new key) or `unsetAgentWallet`; the next commit checks the new signer. Afterwards the agent should commit a gap batch with reason `3 KEY_COMPROMISE` and file an incident (IncidentRegistry v2, Art. 73) naming the affected `seq` range. v3 cannot delete or mark the attacker's batches (§7). If the **owner** key is compromised, the attacker can also transfer the agent; outside v3's reach |
| 8.8 | **Equivocation** | n/a | On-chain: impossible per deployment. Off-chain: conflicting signed batches are evidence (§4.6); on-chain reporting is in v3.1 |
| 8.9 | **Registry upgrade** (new) | n/a | The ERC-8004 owner (`0x5472…2603`) can upgrade the registry's logic, e.g. to make `getAgentWallet` return an attacker. v3 would then accept forged batches at commit time. **Mitigation (DECIDED, §13 Q9):** signer recorded at commit *and* verifier-side implementation-slot check at the commit block (§6.4). Follow-up: ask the ERC-8004 maintainers about a timelock (§13.2, not blocking) |
| 8.10 | **Cross-chain agent confusion** (new) | n/a | `agentId 7` on Base ≠ `agentId 7` on Celo. Evidence must always carry `chainId` + vault + registry. Verifiers must never join chains by `agentId` alone |
| 8.11 | **Withheld logging** | Out of scope | **Out of scope.** An agent can act without logging. v3 makes *declared* gaps visible, not silent omissions (§1) |
| 8.12 | **Griefing** via unknown agents / junk | Anyone could pollute any agent | Only the authorized key can write to an agent's chain. Junk under one's *own* agent ids is possible but cheap to ignore |

`docs/THREAT_MODEL.md` is updated when v3 ships (not in this document's PR): KI-1 and KI-2 are marked "fixed in v3, still present in v2", and 8.9 / 8.10 are added.

---

## 9. Compiler and EVM version — DECIDED (§13 Q10)

**Compiler: solc 0.8.38, exact pragma `pragma solidity 0.8.38;` in every file under `contracts/v3/`.** Checked 2026-10-31 against `binaries.soliditylang.org` and the solidity repo's `docs/bugs_by_version.json`:

| Version | Released | Known bugs |
|---|---|---|
| **0.8.38** (latest stable) | 2026-10-22 | none |
| 0.8.37 | 2026-09-10 | `YulOptimizerKnowledgeBaseStaleBookkeeping` (low, needs Yul optimizer) |
| 0.8.35 (what `out/` is built with today) | 2026-04-29 | 6 incl. `SpillSlotCollisionAcrossMutualRecursion` (low/medium, viaIR) and `InheritanceOrderReversalOnStorageEndWarning` (medium) |

- `via_ir = true`, `optimizer_runs = 200` to match the repo.
- **Deploy gate:** re-check `bugs.json` / `bugs_by_version.json` for 0.8.38 immediately before any deploy (testnet and mainnet). Record the check date in the deployment record.
- The exact pragma departs from the CLAUDE.md convention `pragma solidity ^0.8.20;`. The implementation PR updates CLAUDE.md to say `contracts/v3/` uses the exact pragma.

**EVM version: `prague`.** Probed on 2026-10-31 with `eth_call` creation-code probes on the public RPCs:

| Feature | Fork | Base | Celo |
|---|---|---|---|
| `PUSH0` | shanghai | ✓ | ✓ |
| `TLOAD`, `MCOPY` | cancun | ✓ | ✓ |
| BLS12-381 precompile `0x0b`, `requestsHash` in header | prague | ✓ | ✓ |
| `CLZ` | osaka | ✓ | ✗ `NotActivated` |

Forge 1.7.1 defaults to **`osaka`** (today's `out/` metadata says `evmVersion: osaka`), and the solc version is not pinned in `foundry.toml`. A v3 built with defaults could emit `CLZ` and fail on Celo. v3 **must** set `evm_version = "prague"` and solc 0.8.38 explicitly. Since v3 deploys on both chains, the same bytecode must run on both.

It must do so **without changing the build of existing contracts.** `fixtures/mnemopay-anchor/v1` reproduces a `txHash` from `out/AuditVault.sol` bytecode on anvil, and changing v2's compiler settings could change that. Use a per-path setting (Foundry `additional_compiler_profiles` + `compilation_restrictions` for `contracts/v3/**`) or a separate Foundry profile, and check that v2 artifacts stay bit-identical.

---

## 10. ERC-8021 Builder Codes

ERC-8021 (Draft, PR open; read via eip.tools mirror) appends an attribution suffix to calldata, read from the **end**:

```
txData ‖ schemaData ‖ schemaId (1 B) ‖ ercMarker (16 B = 0x8021 × 8)
schema 0: schemaData = codes (ASCII, comma-separated) ‖ codesLength (1 B)
ERC test vector: 0xdddddddd ‖ 62617365617070 ‖ 07 ‖ 00 ‖ 80218021802180218021802180218021   → ["baseapp"]
```

(The Base docs example puts the length byte *before* the codes, which contradicts the ERC. It makes no difference to v3, but test with the ERC's own vector.)

**Why `commitBatch` is unaffected:**
- Solidity's ABI decoder reads `Batch` (static words) and `signature` / `contentURI` (dynamic, via offsets and lengths). It checks only that calldata is *long enough*, never that it ends where the encoding ends. Trailing bytes are ignored.
- The EIP-712 digest is computed from the decoded fields, never from `msg.data`, so the suffix cannot change `batchHash` or signature validity.
- v3 must not read `msg.data`, `msg.data.length` or `calldatasize()`, and must have no `fallback`. That is a rule for the implementation and review.
- For ERC-4337 the suffix goes into `userOp.callData` (the account's `execute`), not into the inner call to v3. For an EIP-7702 EOA it goes into the transaction calldata, i.e. the same case as above.

**Planned test** (§12): commit the same signed batch twice on two forks of the state, once with plain `abi.encodeCall` calldata and once with the ERC test-vector suffix appended through a low-level `call`. Assert both succeed with identical `nextSeq`, `batchHashAt`, `batchRecord` and event data. Also include a suffix whose bytes look like a valid ABI tail.

---

## 11. Migration

### 11.1 v2 stays live

- AuditVault v2 on Base (`0xCeE831070aa9081422f30df5559c125aa47A75DB`) is not changed, paused or deprecated on-chain. `contracts/v1/` is untouched as always.
- **v2 anchors keep their current meaning:** "this root existed on-chain at block T". They make no statement about who committed it (KI-1). `tools/verify` keeps verifying v2 bundles exactly as today.
- No back-migration: v2 batches are not re-anchored into v3 chains. If an agent wants to reference its v2 history, its v3 genesis payload can list v2 `(txHash, root)` pairs under `metaHash`. That is a statement by the signer, not a proof.

### 11.2 Deployments — DECIDED (§13 Q12)

v3 deploys on **Base and Celo**, both with `IDENTITY_REGISTRY = 0x8004A169…a432`, from the same bytecode (§9). Order: Base Sepolia and Celo Sepolia soak first, then mainnets. A deterministic (CREATE2) address across chains is convenient, and safe because of the domain `chainId`.

### 11.3 Off-chain changes (later PRs, not this one)

| Component | Change |
|---|---|
| `sdk/src/batch.ts` + `index.ts` | Add `vaultVersion: 3` network entries for Base and Celo. Add an RFC 6962 tree builder next to the v2 one (v2 stays the default until switched). `BatchBuffer` tracks `seq` / `prevBatchHash` (read `nextSeq()` / `batchHashAt()` at start, persist locally), signs EIP-712 (`signTypedData`), and submits directly or via a relayer. New payload: `schema: "agentaudit-batch-v3"` (**DECIDED**, §13 Q15) with `tree: "rfc6962-sha256"`, `leaf_data: "action_ref"`, `agent: {chain_id, registry, agent_id}`, `seq`, `prev_batch_hash`, `root_format`; entries unchanged |
| SDK wrappers (`openai`, `anthropic`, `langchain`) | No API change; they inherit from `BatchBuffer` config |
| `src/mcp-server.ts` / `packages/mcp-server` | `audit_action` / `get_audit_log` / `verify_proof` get a v3 path keyed by `agentId` (uint256), with `AUDIT_VAULT_V3_<NETWORK>` overrides |
| `tools/verify` | New checks: schema/rootFormat, RFC 6962 root + inclusion, `batchHash` recomputation, signature → signer (§2.4 rule), signer authorization at block `N`, registry implementation at block `N` against the known-good list (§6.4), chain walk from genesis, gap reporting with reason names (§4.4), equivocation if two conflicting signed batches are given. Still **ethers only**, no imports from `sdk/` or `packages/` |
| `packages/mnemopay-anchor` | New `AuditVaultV3AnchorSink` (`rootFormat 1`, needs `agentId` + agent signer). `AuditVaultAnchorSink` (v2) unchanged |
| `plugin-elizaos/` | **Not changed** in the v3 rollout. It is separately versioned and moves to v3 in its own release |
| Docs | `EVIDENCE_SCHEMA.md` gets a v3 anchoring section next to (not replacing) its own §3 "On-chain anchoring"; `THREAT_MODEL.md` per §8; CLAUDE.md pragma note (§9) |

### 11.4 Fixtures — DECIDED (§13 Q13)

- **Existing fixtures and hashes MUST NOT change.** This covers `fixtures/mnemopay-anchor/v1/**`, `docs/demo/first-anchor-bundle.json`, and the EVIDENCE_SCHEMA §1.2 vector. That includes not changing the compiler settings that produce v2 bytecode (§9).
- New v3 fixtures go in **`fixtures/auditvault-v3/v1/`**, matching the existing `fixtures/<project>/v<N>/` convention:
  - RFC 6962 vectors: n = 1…17 plus a large n, with roots and every inclusion proof.
  - EIP-712 vectors: domain separator, structHash and batchHash for a fixed chain/vault/batch, and a signature from the anvil test key.
  - A 3-batch chain including a gap.
  - An equivocating pair.
- Same rules as the existing fixture: never edit a published version, add `v2/` for a format change.

---

## 12. Test plan (Foundry, for the implementation)

`test/AuditVaultV3.t.sol`, `contract AuditVaultV3Test is Test`. A **mock registry** for unit tests reproduces `getAgentWallet` / `ownerOf` / `setAgentWallet` / `unsetAgentWallet` / transfer-clears-wallet as specified in §2.1. Fork tests run against the real registry on Base and Celo (skippable without RPC). All reverts are asserted with `vm.expectRevert(abi.encodeWithSelector(...))`. Names follow `test_<action>_<condition>`.

| Area | Tests |
|---|---|
| Happy path | `test_commitBatch_genesis`, `test_commitBatch_chainOfThree`, `test_commitBatch_emitsBatchCommitted` (`vm.expectEmit`), `test_commitBatch_recordsSignerAndBlock`, `test_commitBatch_setsBatchHashAt`, `test_commitBatch_anyoneCanRelay` |
| Signer resolution | `test_commitBatch_walletSigns`, `test_commitBatch_ownerSignsWhenWalletUnset`, `test_commitBatch_revertsIfOwnerSignsWhileWalletSet`, `test_commitBatch_revertsIfOperatorSigns`, `test_commitBatch_revertsIfApprovedSigns`, `test_commitBatch_revertsForUnknownAgent` |
| Signature rule (§2.4) | `test_commitBatch_erc1271WalletSigns` (mock wallet), `test_commitBatch_7702DelegatedEoaEcdsaAccepted` (delegate without ERC-1271, `vm.signAndAttachDelegation`), `test_commitBatch_7702DelegatedEoaErc1271Accepted`, `test_commitBatch_revertsOnErc1271WrongMagic`, `test_commitBatch_revertsOnErc1271DirtyReturn`, `test_commitBatch_revertsWhenErc1271Reverts`, `test_commitBatch_revertsOnBadEcdsaFromCodelessSigner`; differential fuzz: v3 accepts ⇔ the registry's `setAgentWallet` check accepts, for the same signer and signature |
| Forgery | `test_commitBatch_revertsIfSignedByStranger`, `test_commitBatch_revertsIfFieldTamperedAfterSigning` (each of the 8 fields, fuzzed), `test_commitBatch_revertsOnWrongRegistry` |
| Replay | `test_commitBatch_revertsOnResubmit` (`SeqMismatch`), `test_commitBatch_revertsWithOtherChainId` (`vm.chainId`), `test_commitBatch_revertsOnOtherVaultDeployment` |
| Continuity | `test_commitBatch_revertsOnSeqSkip`, `test_commitBatch_revertsOnSeqRepeat`, `test_commitBatch_revertsOnWrongPrevBatchHash`, `test_commitBatch_revertsOnNonZeroGenesisPrev`, `test_commitBatch_agentsAreIndependent` |
| Gap | `test_commitBatch_gapAccepted`, `test_commitBatch_unlistedReasonCodeAccepted`, `test_commitBatch_chainContinuesAfterGap`, `test_commitBatch_revertsOnGapWithLeafCount`, `test_commitBatch_revertsOnRootWithZeroLeafCount`, `test_commitBatch_revertsOnGapReasonZero`, `test_commitBatch_revertsOnGapReasonHighBitsSet` |
| rootFormat | `test_commitBatch_acceptsOpaqueRoot`, `test_commitBatch_revertsOnUnknownRootFormat` (fuzz 2–255) |
| Ownership transfer mid-chain | `test_transfer_clearsWalletAndOwnerContinuesChain`, `test_transfer_oldWalletSignatureRejected` (signed before, submitted after), `test_transfer_preTransferRecordsKeepOldSigner` |
| Rotation | `test_setAgentWallet_newKeySignsNextBatch`, `test_setAgentWallet_oldKeyRejected` |
| Malleability | `test_commitBatch_revertsOnHighS`, `test_commitBatch_revertsOnBadV` |
| `verifyInclusion` | `test_verifyInclusion_allLeavesAllSizes` (n = 1…17 from fixture), `test_verifyInclusion_falseForUncommittedBatch`, `test_verifyInclusion_falseForGap`, `test_verifyInclusion_falseForOpaqueRoot`, `test_verifyInclusion_falseOnIndexOutOfRange`, `test_verifyInclusion_falseOnWrongIndex`, `test_verifyInclusion_falseOnTruncatedProof`, `test_verifyInclusion_falseOnExtraProofElement` |
| Node-as-leaf | `test_verifyInclusion_falseForInternalNodeAsLeaf`: every internal node of a fixture tree, presented as `actionRef` with its shorter path at every plausible `(leafIndex, leafCount)`. The same test exists in `tools/verify` (Jest) |
| RFC 6962 vectors | Roots and every inclusion proof for n = 1…17 and n = 1000, generated by the Solidity/TS implementations and **cross-checked against an independent implementation** (Go `github.com/transparency-dev/merkle`, or Python `hashlib`), stored in `fixtures/auditvault-v3/v1/`. A Jest test checks the SDK and `tools/verify` against the same file |
| ERC-8021 | `test_commitBatch_builderCodeSuffixIgnored` (ERC schema-0 vector), `test_commitBatch_suffixLookingLikeAbiTail` (§10) |
| EIP-712 | `test_hashBatch_matchesFixture`, `test_eip712Domain_values`, `test_domainSeparator_recomputedAfterChainIdChange` |
| No-admin | `test_noOwnerOrPauseSelectors`: assert the runtime has no `owner()` / `pause()` / `upgradeTo*` / `commitHighRiskEvent` selectors |
| Fork (Base, Celo) | Real registry: register an agent, commit, transfer, commit as new owner |
| Gas | `forge test --gas-report` replaces the §6.2 estimate |

Target: 100 % branch coverage (`forge coverage`), commit message `feat: AuditVaultV3.sol — Art. 12/19/26, N/N tests passing`.

---

## 13. Decisions (Piotr / Ewelina, 2026-10-31)

### 13.1 Decided

| # | Question | Decision | Rationale |
|---|---|---|---|
| Q1 | Operators as signers? | **DECIDED: no.** Only wallet-or-owner (§2.3) | One clearly defined signer per agent; operator approvals are an NFT-management concept, not a logging authority |
| Q2 | Owner may sign while a wallet is set? | **DECIDED: no.** One signer at a time (§2.3) | The chain's signer at any block is unambiguous; an owner who wants to sign unsets or replaces the wallet, which is visible in registry events |
| Q3 | Signature rule | **DECIDED: mirror the registry, ECDSA first then ERC-1271** (§2.4). OZ 5.x `SignatureChecker.isValidSignatureNow` does **not** do this from v5.1.0 on (only v5.0.0 did), so v3 composes `ECDSA.tryRecover` + `SignatureChecker.isValidERC1271SignatureNow` from OZ v5.7.0 | Every wallet the registry accepts (including EIP-7702-delegated EOAs) can sign batches; no divergence between "may be the agent wallet" and "may sign for the agent" |
| Q4 | Field widths | **DECIDED: `uint64 seq`, `uint64 leafCount`, `uint8 rootFormat`** (§3.2) | Free in EIP-712; tighter storage packing; ranges are far beyond any real use |
| Q5 | `contentURI`; on-chain inclusion check | **DECIDED: `contentURI` unsigned, event-only** (§3.4). **`verifyInclusion` view: yes** (§5.5) | The URI is a locator, and `metaHash` authenticates content. `verifyInclusion` lets contracts and light clients check inclusion against a committed batch without a custom verifier |
| Q6 | `(agentId, seq) → batchHash` index | **DECIDED: yes** (§6.1) | ~22 k gas on an L2 is negligible. It makes lookups and per-`seq` uniqueness trivial, and replaces a separate last-hash slot |
| Q7 | Gap reason code | **DECIDED: reason code inside `metaHash`; the reason-code list lives in this document and we maintain it** (§4.4) | Keeps the `Batch` struct fixed; the code is on-chain and signed; new codes need only a doc PR |
| Q8 | Genesis `prevBatchHash` | **DECIDED: `bytes32(0)`** (§4.2) | No special storage or constant; domain separation already comes from `batchHash` being the full EIP-712 digest |
| Q9 | Registry upgradeability | **DECIDED: both** — verifier-side ERC-1967 implementation check at the commit block **and** signer recorded at commit (§6.4, §8.9) | v3 cannot stop a registry upgrade; it can make one detectable and keep per-batch evidence of who signed |
| Q10 | Compiler | **DECIDED: solc 0.8.38, exact pragma for `contracts/v3/`; re-check bugs.json before any deploy** (§9) | No known bugs at time of writing; an exact pragma makes the audited bytecode reproducible |
| Q11 | `complianceScore` | **DECIDED: dropped** (§1) | Self-reported, unauthenticated in v2, not evidence |
| Q12 | Deployment scope; `commitHighRiskEvent` | **DECIDED: deploy on Base and Celo; drop `commitHighRiskEvent`** (§11.2, §5.4) | The registry is canonical on both chains. A 1-leaf batch covers the high-risk path with the same authentication |
| Q13 | Fixture path | **DECIDED: `fixtures/auditvault-v3/v1/`** (§11.4) | Matches the existing `fixtures/<project>/v<N>/` convention |
| Q14 | Chain reset on transfer | **DECIDED: the chain continues across owners; no reset** (§4.7) | The signer per batch is recorded, so an ownership change is visible to verifiers without breaking continuity |
| Q15 | Batch payload `schema` name | **DECIDED: `agentaudit-batch-v3`** (§11.3) | Differs from `agentaudit-evidence-v1`, so v2 verifiers reject v3 payloads instead of misreading them |

### 13.2 Follow-ups (not blocking v3)

1. **ERC-8004 registry timelock.** Ask the ERC-8004 maintainers whether the IdentityRegistry's UUPS upgrade authority (`owner()` = `0x5472…2603` on Base and Celo) can be put behind a timelock or multisig with a public delay. This would reduce §8.9. v3 does not depend on the answer.
2. **Compiler bug re-check.** Re-check solc 0.8.38 against `bugs.json` / `bugs_by_version.json` immediately before every deploy (§9).
3. **CLAUDE.md.** Note the exact-pragma exception for `contracts/v3/` in the implementation PR (§9).
4. **v3.1 scope.** `reportEquivocation` (§4.6).
