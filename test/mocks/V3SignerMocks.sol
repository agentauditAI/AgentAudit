// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

// ─── ERC-1271 / EIP-7702 signer mocks for AuditVault v3 unit tests (design doc §2.4, §12) ───

/// @title ERC1271Wallet
/// @notice Smart-contract wallet that accepts a signature when ECDSA recovers its `signer` key.
contract ERC1271Wallet {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return (err == ECDSA.RecoverError.NoError && recovered == signer) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// @title ERC1271WrongMagic
/// @notice Always answers with a properly encoded but wrong `bytes4`.
contract ERC1271WrongMagic {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

/// @title ERC1271DirtyReturn
/// @notice Returns the magic value with dirty low-order bytes in the same word (not a valid
///         ABI-encoded `bytes4`). The registry's strict `abi.decode` reverts on it and OZ returns false.
contract ERC1271DirtyReturn {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        assembly {
            mstore(0x00, or(shl(224, 0x1626ba7e), 1))
            return(0x00, 0x20)
        }
    }
}

/// @title ERC1271Reverting
/// @notice Reverts on every `isValidSignature` call.
contract ERC1271Reverting {
    error Nope();

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        revert Nope();
    }
}

/// @title Delegate7702NoErc1271
/// @notice EIP-7702 delegate without ERC-1271 and without a fallback. A delegated EOA keeps
///         signing with plain ECDSA, which v3 must still accept (§2.4).
contract Delegate7702NoErc1271 {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

/// @title Delegate7702Erc1271
/// @notice EIP-7702 delegate that implements ERC-1271 by checking a separate session key, so the
///         ERC-1271 path can be told apart from the delegated EOA's own ECDSA signature.
contract Delegate7702Erc1271 {
    address public immutable sessionKey;

    constructor(address sessionKey_) {
        sessionKey = sessionKey_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return (err == ECDSA.RecoverError.NoError && recovered == sessionKey) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
