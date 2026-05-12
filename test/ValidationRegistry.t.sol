// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/ValidationRegistry.sol";

contract ValidationRegistryTest is Test {
    ValidationRegistry public reg;
    address public user1;

    bytes32 constant AGENT_ID = keccak256("agent-001");

    function setUp() public {
        user1 = makeAddr("user1");
        reg = new ValidationRegistry();
    }

    function test_AddRule() public {
        uint256 id = reg.addRule("Art9-RiskMgmt", "Risk management system check");
        assertEq(id, 1);
        assertEq(reg.ruleCount(), 1);
    }

    function test_AddRule_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ValidationRegistry.RuleAdded(1, "Art9-RiskMgmt");
        reg.addRule("Art9-RiskMgmt", "desc");
    }

    function test_RevertIf_EmptyRuleName() public {
        vm.expectRevert("Name required");
        reg.addRule("", "desc");
    }

    function test_RevertIf_UnauthorizedAddRule() public {
        vm.prank(user1);
        vm.expectRevert("Not owner");
        reg.addRule("test", "desc");
    }

    function test_DeactivateRule() public {
        reg.addRule("Art9-RiskMgmt", "desc");
        reg.deactivateRule(1);
        (,,, bool active) = reg.rules(1);
        assertFalse(active);
    }

    function test_RevertIf_DeactivateNonExistent() public {
        vm.expectRevert("Rule not found");
        reg.deactivateRule(999);
    }

    function test_SubmitValidation_Pass() public {
        reg.addRule("Art9", "desc");
        uint256 id = reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "evidence");
        assertEq(id, 1);
        assertTrue(reg.hasPassedRule(AGENT_ID, 1));
    }

    function test_SubmitValidation_Fail() public {
        reg.addRule("Art9", "desc");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.FAILED, "evidence");
        assertFalse(reg.hasPassedRule(AGENT_ID, 1));
    }

    function test_RevertIf_InvalidAgentId() public {
        reg.addRule("Art9", "desc");
        vm.expectRevert("Invalid agentId");
        reg.submitValidation(bytes32(0), 1, ValidationRegistry.ValidationStatus.PASSED, "ev");
    }

    function test_RevertIf_InactiveRule() public {
        reg.addRule("Art9", "desc");
        reg.deactivateRule(1);
        vm.expectRevert("Rule not active");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "ev");
    }

    function test_AllRulesPassed_True() public {
        reg.addRule("Art9", "desc");
        reg.addRule("Art11", "desc");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "ev");
        reg.submitValidation(AGENT_ID, 2, ValidationRegistry.ValidationStatus.PASSED, "ev");
        assertTrue(reg.allRulesPassed(AGENT_ID));
    }

    function test_AllRulesPassed_False() public {
        reg.addRule("Art9", "desc");
        reg.addRule("Art11", "desc");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "ev");
        assertFalse(reg.allRulesPassed(AGENT_ID));
    }

    function test_AllRulesPassed_SkipsInactive() public {
        reg.addRule("Art9", "desc");
        reg.addRule("Art11", "desc");
        reg.deactivateRule(2);
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "ev");
        assertTrue(reg.allRulesPassed(AGENT_ID));
    }

    function test_GetAgentResults() public {
        reg.addRule("Art9", "desc");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.PASSED, "ev1");
        reg.submitValidation(AGENT_ID, 1, ValidationRegistry.ValidationStatus.FAILED, "ev2");
        assertEq(reg.getAgentResults(AGENT_ID).length, 2);
    }
}
