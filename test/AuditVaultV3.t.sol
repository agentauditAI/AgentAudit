// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {AuditVaultV3} from "../contracts/v3/AuditVaultV3.sol";

/// @notice Toolchain checks for the AuditVault v3 skeleton (design doc §9): the contract
///         compiles under the scoped v3 profile and deploys. No v3 logic exists yet.
contract AuditVaultV3Test is Test {
    string constant ARTIFACT = "out/AuditVaultV3.sol/AuditVaultV3.json";

    function test_deploy_succeeds() public {
        AuditVaultV3 vault = new AuditVaultV3();
        assertGt(address(vault).code.length, 0);
    }

    function test_artifact_compiledWithSolc0838() public view {
        string memory json = vm.readFile(ARTIFACT);
        string memory version = vm.parseJsonString(json, ".metadata.compiler.version");
        assertEq(version, "0.8.38+commit.1835d247");
    }

    function test_artifact_targetsPrague() public view {
        string memory json = vm.readFile(ARTIFACT);
        assertEq(vm.parseJsonString(json, ".metadata.settings.evmVersion"), "prague");
        assertTrue(vm.parseJsonBool(json, ".metadata.settings.viaIR"));
        assertEq(vm.parseJsonUint(json, ".metadata.settings.optimizer.runs"), 200);
    }
}
