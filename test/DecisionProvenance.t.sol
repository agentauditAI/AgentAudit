// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/DecisionProvenance.sol";

contract DecisionProvenanceTest is Test {
    DecisionProvenance public dp;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");
    bytes32 constant INPUT_HASH = keccak256("input-data");
    bytes32 constant OUTPUT_HASH = keccak256("output-data");
    string constant MODEL = "claude-3-opus";
    string constant REASONING = "Classified as high risk";

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        dp = new DecisionProvenance();
    }

    function test_LogDecision() public {
        uint256 id = dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        assertEq(id, 1);
        assertEq(dp.decisionCount(), 1);
    }

    function test_LogDecision_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit DecisionProvenance.DecisionLogged(1, AGENT_ID, OUTPUT_HASH, block.timestamp);
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
    }

    function test_RevertIf_InvalidAgentId() public {
        vm.expectRevert("Invalid agentId");
        dp.logDecision(bytes32(0), INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
    }

    function test_RevertIf_ConfidenceExceeds10000() public {
        vm.expectRevert("Confidence max 10000");
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 10001);
    }

    function test_GetDecision() public {
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        DecisionProvenance.Decision memory d = dp.getDecision(1);
        assertEq(d.agentId, AGENT_ID);
        assertEq(d.confidence, 9500);
        assertFalse(d.humanReviewed);
    }

    function test_VerifyOutput() public {
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        assertTrue(dp.verifyOutput(1, OUTPUT_HASH));
        assertFalse(dp.verifyOutput(1, keccak256("wrong")));
    }

    function test_MarkHumanReviewed() public {
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        dp.markHumanReviewed(1);
        DecisionProvenance.Decision memory d = dp.getDecision(1);
        assertTrue(d.humanReviewed);
        assertEq(d.reviewer, address(this));
    }

    function test_RevertIf_AlreadyReviewed() public {
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        dp.markHumanReviewed(1);
        vm.expectRevert("Already reviewed");
        dp.markHumanReviewed(1);
    }

    function test_RevertIf_DecisionNotFound() public {
        vm.expectRevert("Decision not found");
        dp.markHumanReviewed(999);
    }

    function test_GetAgentDecisions() public {
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 8000);
        uint256[] memory ids = dp.getAgentDecisions(AGENT_ID);
        assertEq(ids.length, 2);
    }

    function test_MultipleAgents() public {
        bytes32 agent2 = keccak256("agent-002");
        dp.logDecision(AGENT_ID, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 9500);
        dp.logDecision(agent2, INPUT_HASH, OUTPUT_HASH, MODEL, REASONING, 7000);
        assertEq(dp.getAgentDecisions(AGENT_ID).length, 1);
        assertEq(dp.getAgentDecisions(agent2).length, 1);
        assertEq(dp.decisionCount(), 2);
    }
}
