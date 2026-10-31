// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

// OpenZeppelin v5.7.0 (lib/openzeppelin-contracts, tag commit cab19933). Imported by
// relative path on purpose: a remapping would be recorded in the metadata of every
// existing contract and change its bytecode (see foundry.toml).
import {EIP712} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "../../lib/openzeppelin-contracts/contracts/utils/cryptography/SignatureChecker.sol";

/// @title AuditVault v3 — toolchain skeleton
/// @notice Placeholder that pins the compiler (solc 0.8.38, evm prague) and the OpenZeppelin
///         primitives AuditVault v3 will use. It has no logic yet.
/// @dev Design: docs/design/AUDITVAULT_V3.md (§2.4 signature rule, §3 EIP-712, §9 toolchain).
/// @custom:article EU AI Act Art. 12, 19, 26 — supports and provides evidence for record-keeping (design doc §1)
contract AuditVaultV3 {}
