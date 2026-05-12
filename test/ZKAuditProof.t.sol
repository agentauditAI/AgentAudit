// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/ZKAuditProof.sol";

contract ZKAuditProofTest is Test {
    ZKAuditProof public zk;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");
    bytes32 constant PROOF_HASH = keccak256("proof-data");
    bytes32 constant INPUT_HASH = keccak256("public-inputs");
    bytes32 constant CIRCUIT_ID = keccak256("eu-ai-act-v1");

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        zk = new ZKAuditProof();
    }

    function test_SubmitProof() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        assertEq(id, 1);
        assertEq(zk.proofCount(), 1);
    }

    function test_SubmitProof_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ZKAuditProof.ProofSubmitted(1, AGENT_ID, PROOF_HASH, block.timestamp);
        zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
    }

    function test_RevertIf_InvalidAgentId() public {
        vm.expectRevert("Invalid agentId");
        zk.submitProof(bytes32(0), PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
    }

    function test_RevertIf_InvalidProofHash() public {
        vm.expectRevert("Invalid proofHash");
        zk.submitProof(AGENT_ID, bytes32(0), INPUT_HASH, CIRCUIT_ID);
    }

    function test_RevertIf_DuplicateProof() public {
        zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        vm.expectRevert("Proof already used");
        zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
    }

    function test_VerifyProof_Compliant() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, true);
        ZKAuditProof.AuditProof memory p = zk.getProof(id);
        assertEq(uint(p.status), uint(ZKAuditProof.ProofStatus.VERIFIED));
        assertTrue(p.complianceResult);
    }

    function test_VerifyProof_NonCompliant() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, false);
        assertFalse(zk.getProof(id).complianceResult);
    }

    function test_RevertIf_VerifyNonExistent() public {
        vm.expectRevert("Proof not found");
        zk.verifyProof(999, true);
    }

    function test_RevertIf_VerifyAlreadyVerified() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, true);
        vm.expectRevert("Not pending");
        zk.verifyProof(id, true);
    }

    function test_RejectProof() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.rejectProof(id);
        assertEq(uint(zk.getProof(id).status), uint(ZKAuditProof.ProofStatus.REJECTED));
    }

    function test_IsValidProof() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, true);
        assertTrue(zk.isValidProof(id));
    }

    function test_IsValidProof_Expired() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, true);
        vm.warp(block.timestamp + 181 days);
        assertFalse(zk.isValidProof(id));
    }

    function test_RevertIf_VerifyExpired() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        vm.warp(block.timestamp + 181 days);
        vm.expectRevert("Proof expired");
        zk.verifyProof(id, true);
    }

    function test_GetLatestValidProof() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        zk.verifyProof(id, true);
        assertEq(zk.getLatestValidProof(AGENT_ID), id);
    }

    function test_GetLatestValidProof_ReturnsZeroIfNone() public {
        assertEq(zk.getLatestValidProof(AGENT_ID), 0);
    }

    function test_GetAgentProofs() public {
        zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        bytes32 proof2 = keccak256("proof-2");
        zk.submitProof(AGENT_ID, proof2, INPUT_HASH, CIRCUIT_ID);
        assertEq(zk.getAgentProofs(AGENT_ID).length, 2);
    }

    function test_RevertIf_UnauthorizedVerify() public {
        uint256 id = zk.submitProof(AGENT_ID, PROOF_HASH, INPUT_HASH, CIRCUIT_ID);
        vm.prank(user1);
        vm.expectRevert("Not owner");
        zk.verifyProof(id, true);
    }
}
