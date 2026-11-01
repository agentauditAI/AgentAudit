// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "../../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "../../lib/openzeppelin-contracts/contracts/interfaces/IERC1271.sol";

/// @title MockERC8004IdentityRegistry — unit-test stand-in for the canonical ERC-8004 IdentityRegistry
/// @notice The function signatures are copied from the verified canonical source:
///         `IdentityRegistryUpgradeable` at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///         (Base / Celo, Basescan + Sourcify exact match, OZ upgradeable 5.4.0), as recorded in
///         docs/design/AUDITVAULT_V3.md §2.1. The behaviour is a reimplementation of what §2.1
///         records, for unit tests only:
///         - `getAgentWallet` returns 0 for an unset wallet or an unknown id, and never reverts
///         - `ownerOf` reverts `ERC721NonexistentToken` for an unknown id
///         - `setAgentWallet` requires an EIP-712 `AgentWalletSet` signature by the new wallet
///           (ECDSA first, then ERC-1271), with the deadline at most 5 minutes ahead
///         - a transfer (not a mint or burn) clears the wallet
///         Fork tests against the real registry on Base and Celo are a later step.
/// @dev Not part of any deployment. Agent ids start at 1 in this mock; the canonical counter's
///      starting value is not recorded in the design doc and v3 does not depend on it.
///      `walletSignatureAccepted` is mock-only: it exposes the registry's signature rule for the
///      differential fuzz test (design doc §12).
/// @custom:article EU AI Act Art. 26 — agent identity (test double)
contract MockERC8004IdentityRegistry is ERC721, EIP712 {
    // ─── Types ───

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
    );

    error NotOwnerOrApproved(address caller, uint256 agentId);
    error DeadlineExpired(uint256 deadline);
    error DeadlineTooFar(uint256 deadline);
    error InvalidWalletSignature(address newWallet);

    // ─── Storage ───

    bytes32 public constant AGENT_WALLET_SET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
    uint256 public constant MAX_DEADLINE_DELAY = 5 minutes;
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    uint256 private _lastId;
    mapping(uint256 agentId => address) private _agentWallet;

    // ─── Functions ───

    constructor() ERC721("AgentIdentity", "AGENT") EIP712("ERC8004IdentityRegistry", "1") {}

    /// @notice Mints a new agent to the caller; the wallet starts as `msg.sender` (§2.1).
    function register() external returns (uint256 agentId) {
        agentId = ++_lastId;
        _mint(msg.sender, agentId);
        _setWallet(agentId, msg.sender);
        emit Registered(agentId, "", msg.sender);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallet[agentId];
    }

    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external {
        address owner = ownerOf(agentId);
        if (!_isAuthorized(owner, msg.sender, agentId)) revert NotOwnerOrApproved(msg.sender, agentId);
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (deadline > block.timestamp + MAX_DEADLINE_DELAY) revert DeadlineTooFar(deadline);
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline)));
        if (!walletSignatureAccepted(newWallet, digest, signature)) revert InvalidWalletSignature(newWallet);
        _setWallet(agentId, newWallet);
    }

    function unsetAgentWallet(uint256 agentId) external {
        address owner = ownerOf(agentId);
        if (!_isAuthorized(owner, msg.sender, agentId)) revert NotOwnerOrApproved(msg.sender, agentId);
        _setWallet(agentId, address(0));
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return _isAuthorized(ownerOf(agentId), spender, agentId);
    }

    /// @notice EIP-712 digest that `setAgentWallet` expects `newWallet` to sign (test helper).
    function agentWalletSetDigest(uint256 agentId, address newWallet, address owner, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline)));
    }

    /// @notice The registry's signature rule (§2.4): ECDSA first, then ERC-1271 with a strict
    ///         `abi.decode` of the result. A wallet returning dirty low-order bytes makes this revert,
    ///         as in the registry.
    function walletSignatureAccepted(address wallet, bytes32 digest, bytes calldata signature)
        public
        view
        returns (bool)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == wallet) return true;
        (bool ok, bytes memory res) = wallet.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        return ok && res.length >= 32 && abi.decode(res, (bytes4)) == ERC1271_MAGIC;
    }

    /// @dev Clears `agentWallet` on every transfer, not on mint or burn (§2.1).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) _setWallet(tokenId, address(0));
    }

    function _setWallet(uint256 agentId, address wallet) private {
        _agentWallet[agentId] = wallet;
        bytes memory value = wallet == address(0) ? bytes("") : abi.encodePacked(wallet);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", value);
    }
}
