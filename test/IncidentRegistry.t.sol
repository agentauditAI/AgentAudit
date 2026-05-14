// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/IncidentRegistry.sol";

contract IncidentRegistryTest is Test {

    IncidentRegistry public reg;

    address deployer  = makeAddr("deployer");
    address reporter  = makeAddr("reporter");
    address stranger  = makeAddr("stranger");
    address authority = makeAddr("authority");

    bytes32 constant AGENT_ID  = keccak256("agent-001");
    bytes32 constant AGENT_ID2 = keccak256("agent-002");

    string constant DESC        = "Agent produced discriminatory hiring decision";
    string constant EVIDENCE    = "ipfs://QmEvidence123";
    string constant AUTH_REF    = "MSA-2026-00042";
    string constant ROOT_CAUSE  = "ipfs://QmRootCause";
    string constant CORRECTION  = "ipfs://QmCorrection";

    IncidentRegistry.Severity constant SEV  = IncidentRegistry.Severity.HIGH;
    IncidentRegistry.HarmType constant HARM = IncidentRegistry.HarmType.FUNDAMENTAL_RIGHTS_VIOLATION;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        reg = new IncidentRegistry();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _register() internal returns (uint256) {
        vm.prank(reporter);
        return reg.registerIncident(AGENT_ID, SEV, HARM, DESC, EVIDENCE, 3, block.timestamp);
    }

    function _register(IncidentRegistry.Severity sev) internal returns (uint256) {
        vm.prank(reporter);
        return reg.registerIncident(AGENT_ID, sev, HARM, DESC, EVIDENCE, 0, block.timestamp);
    }

    function _report(uint256 id) internal {
        vm.prank(reporter);
        reg.markReportedToAuthority(id, authority, AUTH_REF);
    }

    function _investigate(uint256 id) internal {
        _report(id);
        vm.prank(reporter);
        reg.markUnderInvestigation(id);
    }

    function _resolve(uint256 id) internal {
        _investigate(id);
        vm.prank(reporter);
        reg.resolveIncident(id);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), deployer);
    }

    function test_incidentCount_startsAtZero() public view {
        assertEq(reg.incidentCount(), 0);
    }

    function test_constants() public view {
        assertEq(reg.CRITICAL_DEADLINE(),  2 days);
        assertEq(reg.HIGH_DEADLINE(),     10 days);
        assertEq(reg.MEDIUM_DEADLINE(),   15 days);
    }

    // ─── registerIncident ────────────────────────────────────────────────────

    function test_register_success() public {
        uint256 id = _register();
        assertEq(id, 1);
        assertEq(reg.incidentCount(), 1);

        (
            uint256 rid, bytes32 agentId,
            IncidentRegistry.Severity sev, IncidentRegistry.HarmType ht,
            IncidentRegistry.Status status,
            string memory desc, string memory ev,
            uint256 affected, address by, uint256 occAt, uint256 regAt,
            ,,,bool withinDL,,
        ) = reg.incidents(id);

        assertEq(rid, 1);
        assertEq(agentId, AGENT_ID);
        assertEq(uint(sev), uint(SEV));
        assertEq(uint(ht), uint(HARM));
        assertEq(uint(status), uint(IncidentRegistry.Status.OPEN));
        assertEq(desc, DESC);
        assertEq(ev, EVIDENCE);
        assertEq(affected, 3);
        assertEq(by, reporter);
        assertEq(occAt, block.timestamp);
        assertEq(regAt, block.timestamp);
        assertFalse(withinDL);
    }

    function test_register_emitsEvent() public {
        vm.prank(reporter);
        vm.expectEmit(true, true, false, true);
        emit IncidentRegistry.IncidentRegistered(1, AGENT_ID, SEV, HARM, block.timestamp, block.timestamp);
        reg.registerIncident(AGENT_ID, SEV, HARM, DESC, EVIDENCE, 3, block.timestamp);
    }

    function test_register_appendsToAgentList() public {
        _register();
        _register();
        uint256[] memory ids = reg.getAgentIncidents(AGENT_ID);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_register_multipleAgents() public {
        _register();
        vm.prank(reporter);
        reg.registerIncident(AGENT_ID2, SEV, HARM, DESC, EVIDENCE, 0, block.timestamp);
        assertEq(reg.getAgentIncidents(AGENT_ID).length, 1);
        assertEq(reg.getAgentIncidents(AGENT_ID2).length, 1);
    }

    function test_register_allSeverities() public {
        IncidentRegistry.Severity[4] memory sevs = [
            IncidentRegistry.Severity.LOW,
            IncidentRegistry.Severity.MEDIUM,
            IncidentRegistry.Severity.HIGH,
            IncidentRegistry.Severity.CRITICAL
        ];
        for (uint i = 0; i < sevs.length; i++) {
            uint256 id = _register(sevs[i]);
            (,, IncidentRegistry.Severity s,,,,,,,,,,,,,, ) = reg.incidents(id);
            assertEq(uint(s), uint(sevs[i]));
        }
    }

    function test_register_allHarmTypes() public {
        IncidentRegistry.HarmType[5] memory harms = [
            IncidentRegistry.HarmType.DEATH,
            IncidentRegistry.HarmType.SERIOUS_HEALTH_HARM,
            IncidentRegistry.HarmType.SIGNIFICANT_PROPERTY_DAMAGE,
            IncidentRegistry.HarmType.FUNDAMENTAL_RIGHTS_VIOLATION,
            IncidentRegistry.HarmType.OTHER
        ];
        for (uint i = 0; i < harms.length; i++) {
            vm.prank(reporter);
            uint256 id = reg.registerIncident(AGENT_ID, SEV, harms[i], DESC, EVIDENCE, 0, block.timestamp);
            (,,, IncidentRegistry.HarmType ht,,,,,,,,,,,,, ) = reg.incidents(id);
            assertEq(uint(ht), uint(harms[i]));
        }
    }

    function test_register_revertsIfZeroAgentId() public {
        vm.prank(reporter);
        vm.expectRevert(IncidentRegistry.InvalidAgentId.selector);
        reg.registerIncident(bytes32(0), SEV, HARM, DESC, EVIDENCE, 0, block.timestamp);
    }

    function test_register_revertsIfFutureTimestamp() public {
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(
            IncidentRegistry.FutureTimestamp.selector, block.timestamp + 1, block.timestamp
        ));
        reg.registerIncident(AGENT_ID, SEV, HARM, DESC, EVIDENCE, 0, block.timestamp + 1);
    }

    // ─── Deadlines (Art. 73§2) ───────────────────────────────────────────────

    function test_isWithinDeadline_criticalJustRegistered() public {
        uint256 id = _register(IncidentRegistry.Severity.CRITICAL);
        assertTrue(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_criticalBreached() public {
        uint256 id = _register(IncidentRegistry.Severity.CRITICAL);
        vm.warp(block.timestamp + 3 days);
        assertFalse(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_highWithinWindow() public {
        uint256 id = _register(IncidentRegistry.Severity.HIGH);
        vm.warp(block.timestamp + 9 days);
        assertTrue(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_highBreached() public {
        uint256 id = _register(IncidentRegistry.Severity.HIGH);
        vm.warp(block.timestamp + 11 days);
        assertFalse(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_mediumWithinWindow() public {
        uint256 id = _register(IncidentRegistry.Severity.MEDIUM);
        vm.warp(block.timestamp + 14 days);
        assertTrue(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_mediumBreached() public {
        uint256 id = _register(IncidentRegistry.Severity.MEDIUM);
        vm.warp(block.timestamp + 16 days);
        assertFalse(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_lowUsesMediumDeadline() public {
        uint256 id = _register(IncidentRegistry.Severity.LOW);
        vm.warp(block.timestamp + 14 days);
        assertTrue(reg.isWithinDeadline(id));
        vm.warp(block.timestamp + 2 days); // now 16 days total
        assertFalse(reg.isWithinDeadline(id));
    }

    function test_isWithinDeadline_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.IncidentNotFound.selector, 99));
        reg.isWithinDeadline(99);
    }

    function test_reportingDeadline_critical() public {
        uint256 occuredAt = block.timestamp;
        uint256 id = _register(IncidentRegistry.Severity.CRITICAL);
        assertEq(reg.reportingDeadline(id), occuredAt + 2 days);
    }

    function test_reportingDeadline_high() public {
        uint256 occuredAt = block.timestamp;
        uint256 id = _register(IncidentRegistry.Severity.HIGH);
        assertEq(reg.reportingDeadline(id), occuredAt + 10 days);
    }

    // ─── markReportedToAuthority ─────────────────────────────────────────────

    function test_report_withinDeadline() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit IncidentRegistry.IncidentReported(id, authority, AUTH_REF, true, block.timestamp);
        reg.markReportedToAuthority(id, authority, AUTH_REF);

        (,,,, IncidentRegistry.Status status,,,,,, , uint256 rAt, address auth, string memory ref, bool withinDL,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.REPORTED));
        assertEq(rAt, block.timestamp);
        assertEq(auth, authority);
        assertEq(ref, AUTH_REF);
        assertTrue(withinDL);
    }

    function test_report_breachedDeadline() public {
        uint256 id = _register(IncidentRegistry.Severity.CRITICAL);
        vm.warp(block.timestamp + 3 days);
        vm.prank(reporter);
        reg.markReportedToAuthority(id, authority, AUTH_REF);
        (,,,,,,,,,,,, ,, bool withinDL,, ) = reg.incidents(id);
        assertFalse(withinDL);
    }

    function test_report_deployerCanReport() public {
        uint256 id = _register();
        vm.prank(deployer);
        reg.markReportedToAuthority(id, authority, AUTH_REF);
        (,,,, IncidentRegistry.Status status,,,,,,,,,,,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.REPORTED));
    }

    function test_report_revertsIfAlreadyReported() public {
        uint256 id = _register();
        _report(id);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.AlreadyReported.selector, id));
        reg.markReportedToAuthority(id, authority, AUTH_REF);
    }

    function test_report_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.markReportedToAuthority(id, authority, AUTH_REF);
    }

    function test_report_revertsIfNotFound() public {
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.IncidentNotFound.selector, 99));
        reg.markReportedToAuthority(99, authority, AUTH_REF);
    }

    // ─── markUnderInvestigation ──────────────────────────────────────────────

    function test_investigate_success() public {
        uint256 id = _register();
        _report(id);
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit IncidentRegistry.StatusAdvanced(id, IncidentRegistry.Status.REPORTED, IncidentRegistry.Status.UNDER_INVESTIGATION, block.timestamp);
        reg.markUnderInvestigation(id);
        (,,,, IncidentRegistry.Status status,,,,,,,,,,,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.UNDER_INVESTIGATION));
    }

    function test_investigate_revertsIfNotReported() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(
            IncidentRegistry.InvalidStatusTransition.selector,
            IncidentRegistry.Status.OPEN, IncidentRegistry.Status.UNDER_INVESTIGATION
        ));
        reg.markUnderInvestigation(id);
    }

    function test_investigate_revertsIfUnauthorized() public {
        uint256 id = _register();
        _report(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.markUnderInvestigation(id);
    }

    // ─── resolveIncident ─────────────────────────────────────────────────────

    function test_resolve_fromUnderInvestigation() public {
        uint256 id = _register();
        _investigate(id);
        vm.prank(reporter);
        reg.resolveIncident(id);
        (,,,, IncidentRegistry.Status status,,,,,,,,,,,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.RESOLVED));
    }

    function test_resolve_fromReported() public {
        uint256 id = _register();
        _report(id);
        vm.prank(reporter);
        reg.resolveIncident(id);
        (,,,, IncidentRegistry.Status status,,,,,,,,,,,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.RESOLVED));
    }

    function test_resolve_revertsFromOpen() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(
            IncidentRegistry.InvalidStatusTransition.selector,
            IncidentRegistry.Status.OPEN, IncidentRegistry.Status.RESOLVED
        ));
        reg.resolveIncident(id);
    }

    function test_resolve_revertsIfUnauthorized() public {
        uint256 id = _register();
        _investigate(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.resolveIncident(id);
    }

    // ─── closeIncident ───────────────────────────────────────────────────────

    function test_close_success() public {
        uint256 id = _register();
        _resolve(id);
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit IncidentRegistry.StatusAdvanced(id, IncidentRegistry.Status.RESOLVED, IncidentRegistry.Status.CLOSED, block.timestamp);
        reg.closeIncident(id);
        (,,,, IncidentRegistry.Status status,,,,,,,,,,,, ) = reg.incidents(id);
        assertEq(uint(status), uint(IncidentRegistry.Status.CLOSED));
    }

    function test_close_revertsIfNotResolved() public {
        uint256 id = _register();
        _investigate(id);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(
            IncidentRegistry.InvalidStatusTransition.selector,
            IncidentRegistry.Status.UNDER_INVESTIGATION, IncidentRegistry.Status.CLOSED
        ));
        reg.closeIncident(id);
    }

    function test_close_revertsIfUnauthorized() public {
        uint256 id = _register();
        _resolve(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.closeIncident(id);
    }

    // ─── Documentation (Art. 73§5) ───────────────────────────────────────────

    function test_updateRootCause_success() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit IncidentRegistry.RootCauseUpdated(id, ROOT_CAUSE, block.timestamp);
        reg.updateRootCause(id, ROOT_CAUSE);
        (,,,,,,,,,,,,,,, string memory rc, ) = reg.incidents(id);
        assertEq(rc, ROOT_CAUSE);
    }

    function test_updateRootCause_revertsIfClosed() public {
        uint256 id = _register();
        _resolve(id);
        vm.prank(reporter);
        reg.closeIncident(id);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.AlreadyClosed.selector, id));
        reg.updateRootCause(id, ROOT_CAUSE);
    }

    function test_updateRootCause_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.updateRootCause(id, ROOT_CAUSE);
    }

    function test_updateCorrection_success() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit IncidentRegistry.CorrectionUpdated(id, CORRECTION, block.timestamp);
        reg.updateCorrection(id, CORRECTION);
        (,,,,,,,,,,,,,,,, string memory corr) = reg.incidents(id);
        assertEq(corr, CORRECTION);
    }

    function test_updateCorrection_revertsIfClosed() public {
        uint256 id = _register();
        _resolve(id);
        vm.prank(reporter);
        reg.closeIncident(id);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.AlreadyClosed.selector, id));
        reg.updateCorrection(id, CORRECTION);
    }

    function test_updateCorrection_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IncidentRegistry.NotAuthorized.selector, stranger));
        reg.updateCorrection(id, CORRECTION);
    }

    // ─── Full lifecycle ──────────────────────────────────────────────────────

    function test_fullLifecycle() public {
        uint256 id = _register();

        // Attach evidence before reporting
        vm.prank(reporter);
        reg.updateRootCause(id, ROOT_CAUSE);

        // Report to authority within deadline
        _report(id);

        // Attach corrective measures
        vm.prank(reporter);
        reg.updateCorrection(id, CORRECTION);

        // Move through investigation → resolve → close
        vm.prank(reporter);
        reg.markUnderInvestigation(id);
        vm.prank(reporter);
        reg.resolveIncident(id);
        vm.prank(reporter);
        reg.closeIncident(id);

        (
            ,,,, IncidentRegistry.Status status,,,,,,,,,, bool withinDL,
            string memory rc, string memory corr
        ) = reg.incidents(id);

        assertEq(uint(status), uint(IncidentRegistry.Status.CLOSED));
        assertTrue(withinDL);
        assertEq(rc, ROOT_CAUSE);
        assertEq(corr, CORRECTION);
    }
}
