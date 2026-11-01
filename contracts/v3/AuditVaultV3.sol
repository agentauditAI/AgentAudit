// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

// OpenZeppelin v5.7.0 (lib/openzeppelin-contracts, tag commit cab19933). Imported by
// relative path on purpose: a remapping would be recorded in the metadata of every
// existing contract and change its bytecode (see foundry.toml).
import {EIP712} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice The two canonical ERC-8004 IdentityRegistry functions AuditVault v3 calls.
/// @dev Signatures copied from the verified `IdentityRegistryUpgradeable` source at
///      0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (design doc §2.1).
interface IERC8004IdentityRegistry {
    /// @notice `agentWallet` metadata of the agent; 0 when unset. Does not revert for unknown ids.
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice ERC-721 owner; reverts `ERC721NonexistentToken` for unknown ids.
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title AuditVault v3 — signed, per-agent hash-chained batch commitments
/// @notice Every batch is an EIP-712 `Batch` signed by the key the canonical ERC-8004
///         IdentityRegistry authorizes for the agent (its `agentWallet`, else its owner). Batches of
///         an agent form a hash chain (`seq`, `prevBatchHash`), and an agent can declare a gap.
///         Merkle roots use RFC 6962 SHA-256 (`rootFormat` 0) or are opaque (`rootFormat` 1).
///         Anyone may submit a signed batch; the submitter has no authority.
/// @dev Design: docs/design/AUDITVAULT_V3.md (source of truth). No owner, no pause, no proxy,
///      no fallback, and no reads of `msg.data`: trailing calldata such as an ERC-8021 builder-code
///      suffix is ignored (§10). Closes KI-1 (unauthenticated commits) and KI-2 (node-as-leaf).
///      Not a compliance determination (§1).
/// @custom:article EU AI Act Art. 12, 19, 26 — supports and provides evidence for record-keeping (design doc §1)
contract AuditVaultV3 is EIP712 {
    // ─── Types ───

    /// @notice The signed batch (design doc §3.2). EIP-712 type:
    ///         `Batch(address identityRegistry,uint256 agentId,uint64 seq,bytes32 prevBatchHash,bytes32 root,uint64 leafCount,uint8 rootFormat,bytes32 metaHash)`
    struct Batch {
        address identityRegistry; // must equal IDENTITY_REGISTRY
        uint256 agentId; // ERC-8004 token id
        uint64 seq; // 0-based per-agent sequence number
        bytes32 prevBatchHash; // batchHash of seq - 1; 0 for seq 0
        bytes32 root; // Merkle root; 0 only for a gap
        uint64 leafCount; // number of leaves; 0 only for a gap
        uint8 rootFormat; // 0 = RFC6962-SHA256, 1 = opaque/foreign
        bytes32 metaHash; // commitment to the off-chain payload; for a gap, the reason code
    }

    /// @notice What is stored per committed batch (one slot).
    /// @dev `timestamp` is `uint32(block.timestamp)` and wraps in 2106 (design doc §6.1).
    struct Record {
        address signer; // authorized signer resolved at commit time
        uint64 blockNumber;
        uint32 timestamp;
    }

    /// @custom:article EU AI Act Art. 12, 19 — automatically generated, tamper-evident log entry
    event BatchCommitted(
        uint256 indexed agentId,
        uint64 indexed seq,
        bytes32 indexed batchHash,
        bytes32 prevBatchHash,
        bytes32 root,
        uint64 leafCount,
        uint8 rootFormat,
        bytes32 metaHash,
        address signer,
        address submitter,
        string contentURI
    );

    error WrongRegistry(address got);
    error UnknownAgent(uint256 agentId);
    error SeqMismatch(uint64 expected, uint64 got);
    error PrevBatchHashMismatch(bytes32 expected, bytes32 got);
    error InvalidSignature(address expectedSigner);
    error UnknownRootFormat(uint8 rootFormat);
    /// @notice `root == 0` with `leafCount != 0`, or `leafCount == 0` with `root != 0`.
    error EmptyBatch();
    /// @notice Gap encoding violated: reason code 0, upper 240 bits set, or `rootFormat != 0` (§4.4).
    error InvalidGap(bytes32 metaHash);
    /// @notice Constructor argument has no code (an EOA or an undeployed address).
    error RegistryNotContract(address identityRegistry);

    // ─── Storage ───

    bytes32 public constant BATCH_TYPEHASH = keccak256(
        "Batch(address identityRegistry,uint256 agentId,uint64 seq,bytes32 prevBatchHash,bytes32 root,uint64 leafCount,uint8 rootFormat,bytes32 metaHash)"
    );
    uint8 public constant ROOT_FORMAT_RFC6962_SHA256 = 0;
    uint8 public constant ROOT_FORMAT_OPAQUE = 1;

    /// @notice The canonical ERC-8004 IdentityRegistry this deployment serves (immutable, §2.2).
    address public immutable IDENTITY_REGISTRY;

    /// @notice Next expected `seq` per agent; 0 before genesis.
    mapping(uint256 agentId => uint64) public nextSeq;
    /// @notice `batchHash` of each committed `(agentId, seq)`; 0 if not committed.
    mapping(uint256 agentId => mapping(uint64 seq => bytes32)) public batchHashAt;
    /// @notice Signer, block and time of each committed batch; zero record if not committed.
    mapping(bytes32 batchHash => Record) public batchRecord;

    // ─── Functions ───

    /// @param identityRegistry The canonical ERC-8004 IdentityRegistry (0x8004A169…a432 on Base and Celo).
    /// @dev There is no admin to fix a wrong registry address after deploy, so an address without code
    ///      is rejected. This does not prove the address is the canonical registry: that stays a deploy
    ///      checklist item, and verifiers check the registry implementation at the commit block (§6.4).
    constructor(address identityRegistry) EIP712("AgentAudit AuditVault", "3") {
        if (identityRegistry.code.length == 0) revert RegistryNotContract(identityRegistry);
        IDENTITY_REGISTRY = identityRegistry;
    }

    /// @notice Commits a signed batch as the next link of its agent's chain (design doc §4.1).
    /// @dev Checks in order: registry, rootFormat, shape (normal or gap), seq, prevBatchHash,
    ///      signer and signature. The only external calls are view calls to the registry and an
    ///      ERC-1271 staticcall, made before any state is written.
    /// @param b The signed batch.
    /// @param signature ECDSA (65 bytes) or ERC-1271 signature over `hashBatch(b)` by `authorizedSigner(b.agentId)`.
    /// @param contentURI Unsigned locator of the off-chain payload, emitted only (§3.4).
    /// @return batchHash The EIP-712 digest of `b`.
    /// @custom:article EU AI Act Art. 12, 19, 26
    function commitBatch(Batch calldata b, bytes calldata signature, string calldata contentURI)
        external
        returns (bytes32 batchHash)
    {
        if (b.identityRegistry != IDENTITY_REGISTRY) revert WrongRegistry(b.identityRegistry);
        if (b.rootFormat > ROOT_FORMAT_OPAQUE) revert UnknownRootFormat(b.rootFormat);
        if (b.root == bytes32(0)) {
            if (b.leafCount != 0) revert EmptyBatch();
            // Declared gap (§4.4): rootFormat 0, metaHash = bytes32(uint256(reasonCode)), reasonCode in [1, 65535].
            if (b.rootFormat != ROOT_FORMAT_RFC6962_SHA256 || b.metaHash == bytes32(0) || uint256(b.metaHash) > type(uint16).max)
            {
                revert InvalidGap(b.metaHash);
            }
        } else if (b.leafCount == 0) {
            revert EmptyBatch();
        }

        uint256 agentId = b.agentId;
        uint64 seq = nextSeq[agentId];
        if (b.seq != seq) revert SeqMismatch(seq, b.seq);
        bytes32 expectedPrev = seq == 0 ? bytes32(0) : batchHashAt[agentId][seq - 1];
        if (b.prevBatchHash != expectedPrev) revert PrevBatchHashMismatch(expectedPrev, b.prevBatchHash);

        batchHash = _hashBatch(b);
        address signer = _authorizedSigner(agentId);
        if (!_isValidSignature(signer, batchHash, signature)) revert InvalidSignature(signer);

        nextSeq[agentId] = seq + 1;
        batchHashAt[agentId][seq] = batchHash;
        batchRecord[batchHash] = Record(signer, uint64(block.number), uint32(block.timestamp));

        emit BatchCommitted(
            agentId,
            seq,
            batchHash,
            b.prevBatchHash,
            b.root,
            b.leafCount,
            b.rootFormat,
            b.metaHash,
            signer,
            msg.sender,
            contentURI
        );
    }

    /// @notice The EIP-712 digest of `b` in this deployment's domain (the batch's identity, §3.2).
    function hashBatch(Batch calldata b) external view returns (bytes32) {
        return _hashBatch(b);
    }

    /// @notice The key that may sign batches for `agentId` right now: its `agentWallet` if set,
    ///         else its owner (§2.3). Reverts `UnknownAgent` for an agent that does not exist.
    function authorizedSigner(uint256 agentId) external view returns (address) {
        return _authorizedSigner(agentId);
    }

    /// @notice True only if `b` was committed here with `rootFormat` 0 and `actionRef` is leaf
    ///         `leafIndex` of its RFC 6962 tree under `proof` (design doc §5.5). Never reverts on bad input.
    /// @dev RFC 9162 §2.1.3.2 with `leaf = sha256(0x00 ‖ actionRef)`: the leaf hash is computed here,
    ///      so an internal node cannot be presented as a leaf (KI-2). Does not prove that `actionRef`
    ///      is the hash of a real preimage; verifiers recompute it.
    function verifyInclusion(Batch calldata b, uint64 leafIndex, bytes32 actionRef, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        if (batchRecord[_hashBatch(b)].signer == address(0)) return false;
        if (b.rootFormat != ROOT_FORMAT_RFC6962_SHA256 || b.leafCount == 0) return false;
        if (leafIndex >= b.leafCount) return false;

        uint256 fn = leafIndex;
        uint256 sn = b.leafCount - 1;
        bytes32 r = sha256(abi.encodePacked(bytes1(0x00), actionRef));
        for (uint256 i = 0; i < proof.length; ++i) {
            if (sn == 0) return false;
            if (fn & 1 == 1 || fn == sn) {
                r = _nodeHash(proof[i], r);
                while (fn & 1 == 0 && fn != 0) {
                    fn >>= 1;
                    sn >>= 1;
                }
            } else {
                r = _nodeHash(r, proof[i]);
            }
            fn >>= 1;
            sn >>= 1;
        }
        return sn == 0 && r == b.root;
    }

    function _hashBatch(Batch calldata b) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BATCH_TYPEHASH,
                    b.identityRegistry,
                    b.agentId,
                    b.seq,
                    b.prevBatchHash,
                    b.root,
                    b.leafCount,
                    b.rootFormat,
                    b.metaHash
                )
            )
        );
    }

    /// @dev Wallet first: `getAgentWallet` never reverts, `ownerOf` reverts for an unknown id (§2.3).
    function _authorizedSigner(uint256 agentId) internal view returns (address) {
        IERC8004IdentityRegistry registry = IERC8004IdentityRegistry(IDENTITY_REGISTRY);
        address wallet = registry.getAgentWallet(agentId);
        if (wallet != address(0)) return wallet;
        try registry.ownerOf(agentId) returns (address owner) {
            if (owner == address(0)) revert UnknownAgent(agentId);
            return owner;
        } catch {
            revert UnknownAgent(agentId);
        }
    }

    /// @dev Mirrors the registry's `setAgentWallet` rule (§2.4): ECDSA first, then ERC-1271. OZ v5.7.0
    ///      `SignatureChecker.isValidSignatureNow` would send an EIP-7702-delegated EOA to ERC-1271 only.
    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        return SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, signature);
    }

    function _nodeHash(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }
}
