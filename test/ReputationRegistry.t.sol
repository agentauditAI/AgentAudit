// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/ReputationRegistry.sol";

contract ReputationRegistryTest is Test {
    ReputationRegistry public reg;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        reg = new ReputationRegistry();
    }

    function test_SubmitFeedback() public {
        uint256 id = reg.submitFeedback(AGENT_ID, 5, "Excellent");
        assertEq(id, 1);
        assertEq(reg.feedbackCount(), 1);
    }

    function test_SubmitFeedback_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.FeedbackSubmitted(1, AGENT_ID, 5, address(this));
        reg.submitFeedback(AGENT_ID, 5, "Excellent");
    }

    function test_RevertIf_InvalidAgentId() public {
        vm.expectRevert("Invalid agentId");
        reg.submitFeedback(bytes32(0), 5, "test");
    }

    function test_RevertIf_ScoreZero() public {
        vm.expectRevert("Score must be 1-5");
        reg.submitFeedback(AGENT_ID, 0, "test");
    }

    function test_RevertIf_ScoreSix() public {
        vm.expectRevert("Score must be 1-5");
        reg.submitFeedback(AGENT_ID, 6, "test");
    }

    function test_GetAverageScore_Single() public {
        reg.submitFeedback(AGENT_ID, 4, "Good");
        assertEq(reg.getAverageScore(AGENT_ID), 400);
    }

    function test_GetAverageScore_Multiple() public {
        reg.submitFeedback(AGENT_ID, 4, "Good");
        reg.submitFeedback(AGENT_ID, 2, "Bad");
        assertEq(reg.getAverageScore(AGENT_ID), 300);
    }

    function test_GetAverageScore_NoFeedback() public {
        assertEq(reg.getAverageScore(AGENT_ID), 0);
    }

    function test_UpdateComplianceTag() public {
        reg.updateComplianceTag(AGENT_ID, true, 95);
        ReputationRegistry.ReputationRecord memory r = reg.getReputation(AGENT_ID);
        assertTrue(r.euAiActCompliant);
        assertEq(r.complianceScore, 95);
    }

    function test_UpdateComplianceTag_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ReputationRegistry.ComplianceTagUpdated(AGENT_ID, true, 95);
        reg.updateComplianceTag(AGENT_ID, true, 95);
    }

    function test_RevertIf_UnauthorizedComplianceUpdate() public {
        vm.prank(user1);
        vm.expectRevert("Not owner");
        reg.updateComplianceTag(AGENT_ID, true, 95);
    }

    function test_RevertIf_ComplianceScoreOver100() public {
        vm.expectRevert("Score max 100");
        reg.updateComplianceTag(AGENT_ID, true, 101);
    }

    function test_GetAgentFeedbacks() public {
        reg.submitFeedback(AGENT_ID, 5, "A");
        reg.submitFeedback(AGENT_ID, 3, "B");
        assertEq(reg.getAgentFeedbacks(AGENT_ID).length, 2);
    }

    function test_MultipleFeedbackFromDifferentUsers() public {
        vm.prank(user1);
        reg.submitFeedback(AGENT_ID, 5, "Great");
        vm.prank(user2);
        reg.submitFeedback(AGENT_ID, 3, "Ok");
        assertEq(reg.getReputation(AGENT_ID).feedbackCount, 2);
    }
}
