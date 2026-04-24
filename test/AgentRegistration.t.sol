// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AgentRegistration.sol";

contract AgentRegistrationTest is Test {
    AgentRegistration public registry;
    address public operator = address(0x1234);

    function setUp() public {
        registry = new AgentRegistration();
    }

    function test_RegisterAgent() public {
        vm.prank(operator);
        uint256 agentId = registry.registerAgent(
            "test-agent",
            "limited",
            1 ether,
            address(0xABCD)
        );

        assertEq(agentId, 1);
        assertEq(registry.agentCount(), 1);
    }

    function test_AgentIsActive() public {
        vm.prank(operator);
        uint256 agentId = registry.registerAgent(
            "test-agent",
            "limited",
            1 ether,
            address(0xABCD)
        );

        assertTrue(registry.isActive(agentId));
    }

    function test_RevokeAgent() public {
        vm.prank(operator);
        uint256 agentId = registry.registerAgent(
            "test-agent",
            "limited",
            1 ether,
            address(0xABCD)
        );

        vm.prank(operator);
        registry.revokeAgent(agentId);

        assertFalse(registry.isActive(agentId));
    }

    function test_OnlyOperatorCanRevoke() public {
        vm.prank(operator);
        uint256 agentId = registry.registerAgent(
            "test-agent",
            "limited",
            1 ether,
            address(0xABCD)
        );

        vm.prank(address(0x9999));
        vm.expectRevert("Not agent operator");
        registry.revokeAgent(agentId);
    }

    function test_GetOperatorAgents() public {
        vm.startPrank(operator);
        registry.registerAgent("agent-1", "minimal", 1 ether, address(0xABCD));
        registry.registerAgent("agent-2", "high", 2 ether, address(0xABCD));
        vm.stopPrank();

        uint256[] memory ids = registry.getOperatorAgents(operator);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }
}