// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AgentIdentityRegistry.sol";

contract AgentIdentityRegistryTest is Test {
    AgentIdentityRegistry public registry;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");
    string constant NAME = "TestAgent";
    string constant VERSION = "1.0.0";
    string constant MODEL = "gpt-4o";
    string constant PURPOSE = "ipfs://QmPurpose123";

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        registry = new AgentIdentityRegistry();
    }

    function test_RegisterAgent() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        AgentIdentityRegistry.AgentIdentity memory a = registry.getAgent(AGENT_ID);
        assertEq(a.name, NAME);
        assertEq(uint(a.status), uint(AgentIdentityRegistry.AgentStatus.ACTIVE));
    }

    function test_RegisterAgent_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit AgentIdentityRegistry.AgentRegistered(AGENT_ID, address(this), NAME, block.timestamp);
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
    }

    function test_RevertIf_DuplicateRegister() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        vm.expectRevert("Agent already registered");
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
    }

    function test_RevertIf_EmptyAgentId() public {
        vm.expectRevert("Invalid agentId");
        registry.registerAgent(bytes32(0), user1, NAME, VERSION, MODEL, PURPOSE, false);
    }

    function test_RevertIf_EmptyName() public {
        vm.expectRevert("Name required");
        registry.registerAgent(AGENT_ID, user1, "", VERSION, MODEL, PURPOSE, false);
    }

    function test_IsActive() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        assertTrue(registry.isActive(AGENT_ID));
    }

    function test_UpdateStatus_Suspend() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        registry.updateStatus(AGENT_ID, AgentIdentityRegistry.AgentStatus.SUSPENDED);
        assertFalse(registry.isActive(AGENT_ID));
    }

    function test_RevertIf_UnauthorizedUpdate() public {
        vm.prank(user1);
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        vm.prank(user2);
        vm.expectRevert("Not authorized");
        registry.updateStatus(AGENT_ID, AgentIdentityRegistry.AgentStatus.SUSPENDED);
    }

    function test_RevokeAgent() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        registry.revokeAgent(AGENT_ID);
        assertEq(uint(registry.getAgent(AGENT_ID).status), uint(AgentIdentityRegistry.AgentStatus.REVOKED));
    }

    function test_RevertIf_UpdateRevokedAgent() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        registry.revokeAgent(AGENT_ID);
        vm.expectRevert("Cannot update revoked agent");
        registry.updateStatus(AGENT_ID, AgentIdentityRegistry.AgentStatus.ACTIVE);
    }

    function test_HighRiskFlag() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, true);
        assertTrue(registry.getAgent(AGENT_ID).highRisk);
    }

    function test_GetOwnerAgents() public {
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        bytes32 agent2 = keccak256("agent-002");
        registry.registerAgent(agent2, user1, NAME, VERSION, MODEL, PURPOSE, false);
        bytes32[] memory owned = registry.getOwnerAgents(address(this));
        assertEq(owned.length, 2);
    }

    function test_GetTotalAgents() public {
        assertEq(registry.getTotalAgents(), 0);
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        assertEq(registry.getTotalAgents(), 1);
    }

    function test_OwnerCanUpdateAnyAgent() public {
        vm.prank(user1);
        registry.registerAgent(AGENT_ID, user1, NAME, VERSION, MODEL, PURPOSE, false);
        registry.updateStatus(AGENT_ID, AgentIdentityRegistry.AgentStatus.SUSPENDED);
        assertFalse(registry.isActive(AGENT_ID));
    }
}