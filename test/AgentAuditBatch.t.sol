// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AgentAuditBatch.sol";

contract AgentAuditBatchTest is Test {
    AgentAuditBatch public auditBatch;
    address public operator = address(0x1234);

    function setUp() public {
        auditBatch = new AgentAuditBatch();
    }

    function test_LogAction() public {
        vm.prank(operator);
        auditBatch.logAction(
            1,
            "TRANSFER",
            keccak256(abi.encodePacked("payload-data"))
        );

        assertEq(auditBatch.getLogCount(1), 1);
    }

    function test_LogActionBatch() public {
        string[] memory actionTypes = new string[](3);
        actionTypes[0] = "TRANSFER";
        actionTypes[1] = "SWAP";
        actionTypes[2] = "APPROVE";

        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = keccak256(abi.encodePacked("payload-1"));
        hashes[1] = keccak256(abi.encodePacked("payload-2"));
        hashes[2] = keccak256(abi.encodePacked("payload-3"));

        vm.prank(operator);
        auditBatch.logActionBatch(1, actionTypes, hashes);

        assertEq(auditBatch.getLogCount(1), 3);
    }

    function test_BatchRequiresMatchingArrays() public {
        string[] memory actionTypes = new string[](2);
        actionTypes[0] = "TRANSFER";
        actionTypes[1] = "SWAP";

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = keccak256(abi.encodePacked("payload-1"));

        vm.expectRevert("Array length mismatch");
        auditBatch.logActionBatch(1, actionTypes, hashes);
    }

    function test_EmptyBatchReverts() public {
        string[] memory actionTypes = new string[](0);
        bytes32[] memory hashes = new bytes32[](0);

        vm.expectRevert("Empty batch");
        auditBatch.logActionBatch(1, actionTypes, hashes);
    }

    function test_MultipleAgentLogs() public {
        auditBatch.logAction(1, "TRANSFER", keccak256(abi.encodePacked("p1")));
        auditBatch.logAction(2, "SWAP", keccak256(abi.encodePacked("p2")));
        auditBatch.logAction(1, "APPROVE", keccak256(abi.encodePacked("p3")));

        assertEq(auditBatch.getLogCount(1), 2);
        assertEq(auditBatch.getLogCount(2), 1);
    }
}