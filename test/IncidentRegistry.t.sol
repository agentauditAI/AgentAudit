// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/IncidentRegistry.sol";

contract IncidentRegistryTest is Test {
    IncidentRegistry public registry;
    address public owner;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");
    string constant DESC = "Agent produced biased output";
    string constant EVIDENCE = "ipfs://QmEvidence123";

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        registry = new IncidentRegistry();
    }

    // ── Register ──────────────────────────────────────────────────────────────

    function test_RegisterIncident() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        assertEq(id, 1);
        assertEq(registry.incidentCount(), 1);
    }

    function test_RegisterIncident_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit IncidentRegistry.IncidentRegistered(1, AGENT_ID, IncidentRegistry.Severity.HIGH, block.timestamp);
        registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
    }

    function test_RevertIf_InvalidAgentId() public {
        vm.expectRevert("Invalid agentId");
        registry.registerIncident(bytes32(0), IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
    }

    function test_RevertIf_FutureTimestamp() public {
        vm.expectRevert("Future timestamp");
        registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp + 1);
    }

    function test_MultipleIncidents() public {
        registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.CRITICAL, DESC, EVIDENCE, block.timestamp);
        uint256[] memory ids = registry.getAgentIncidents(AGENT_ID);
        assertEq(ids.length, 2);
    }

    // ── Deadlines (Art. 73) ───────────────────────────────────────────────────

    function test_WithinDeadline_Critical() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.CRITICAL, DESC, EVIDENCE, block.timestamp);
        assertTrue(registry.isWithinDeadline(id));
    }

    function test_BreachedDeadline_Critical() public {
        uint256 occurredAt = block.timestamp;
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.CRITICAL, DESC, EVIDENCE, occurredAt);
        vm.warp(block.timestamp + 3 days);
        assertFalse(registry.isWithinDeadline(id));
    }

    function test_WithinDeadline_High() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        vm.warp(block.timestamp + 9 days);
        assertTrue(registry.isWithinDeadline(id));
    }

    function test_BreachedDeadline_High() public {
        uint256 occurredAt = block.timestamp;
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, occurredAt);
        vm.warp(block.timestamp + 11 days);
        assertFalse(registry.isWithinDeadline(id));
    }

    function test_WithinDeadline_Medium() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.MEDIUM, DESC, EVIDENCE, block.timestamp);
        vm.warp(block.timestamp + 14 days);
        assertTrue(registry.isWithinDeadline(id));
    }

    // ── Report to Authority ───────────────────────────────────────────────────

    function test_MarkReportedToAuthority_WithinDeadline() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        registry.markReportedToAuthority(id);
        (,,,IncidentRegistry.Status status,,,,,,, bool withinDeadline) = registry.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.REPORTED));
        assertTrue(withinDeadline);
    }

    function test_MarkReportedToAuthority_BreachedDeadline() public {
        uint256 occurredAt = block.timestamp;
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.CRITICAL, DESC, EVIDENCE, occurredAt);
        vm.warp(block.timestamp + 3 days);
        registry.markReportedToAuthority(id);
        (,,,,,,,,,, bool withinDeadline) = registry.incidents(id);
        assertFalse(withinDeadline);
    }

    function test_RevertIf_AlreadyReported() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        registry.markReportedToAuthority(id);
        vm.expectRevert("Already reported");
        registry.markReportedToAuthority(id);
    }

    // ── Resolve ───────────────────────────────────────────────────────────────

    function test_ResolveIncident() public {
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        registry.resolveIncident(id);
        (,,,IncidentRegistry.Status status,,,,,,, ) = registry.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.RESOLVED));
    }

    function test_RevertIf_UnauthorizedResolve() public {
        vm.prank(user1);
        uint256 id = registry.registerIncident(AGENT_ID, IncidentRegistry.Severity.HIGH, DESC, EVIDENCE, block.timestamp);
        vm.prank(user2);
        vm.expectRevert("Not authorized");
        registry.resolveIncident(id);
    }

    function test_RevertIf_ResolveNonExistent() public {
        vm.expectRevert("Incident not found");
        registry.resolveIncident(999);
    }
}
