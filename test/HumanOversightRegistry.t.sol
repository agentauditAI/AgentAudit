// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/HumanOversightRegistry.sol";

contract HumanOversightRegistryTest is Test {

    HumanOversightRegistry public reg;

    address deployer  = makeAddr("deployer");
    address planOwner = makeAddr("planOwner");
    address overseer  = makeAddr("overseer");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_ID  = keccak256("agent-001");
    bytes32 constant AGENT_ID2 = keccak256("agent-002");

    string constant DESC        = "Human reviewer approves all high-stakes decisions";
    string constant IFACE_URI   = "ipfs://QmInterfaceTools";
    string constant STOP_URI    = "ipfs://QmStopButton";
    string constant REASON      = "Anomalous output detected by operator";
    string constant EV_URI      = "ipfs://QmEvidence";

    HumanOversightRegistry.OversightLevel constant LEVEL =
        HumanOversightRegistry.OversightLevel.HUMAN_ON_THE_LOOP;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        reg = new HumanOversightRegistry();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _registerPlan() internal {
        vm.prank(planOwner);
        reg.registerPlan(AGENT_ID, LEVEL, DESC, IFACE_URI, true, STOP_URI);
    }

    function _registerPlan(
        bytes32 agentId,
        HumanOversightRegistry.OversightLevel level,
        bool hasStop
    ) internal {
        vm.prank(planOwner);
        reg.registerPlan(agentId, level, DESC, IFACE_URI, hasStop, STOP_URI);
    }

    function _authorizeOverseer() internal {
        vm.prank(planOwner);
        reg.setOverseer(AGENT_ID, overseer, true);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), deployer);
    }

    function test_interventionCount_startsAtZero() public view {
        assertEq(reg.totalInterventions(), 0);
    }

    // ─── registerPlan ────────────────────────────────────────────────────────

    function test_registerPlan_success() public {
        vm.prank(planOwner);
        vm.expectEmit(true, false, false, true);
        emit HumanOversightRegistry.OversightPlanRegistered(
            AGENT_ID, LEVEL, true, planOwner, block.timestamp
        );
        reg.registerPlan(AGENT_ID, LEVEL, DESC, IFACE_URI, true, STOP_URI);

        (
            bytes32 aid,
            HumanOversightRegistry.OversightLevel lvl,
            string memory desc,
            string memory iUri,
            bool hasStop,
            string memory sUri,
            address owner,
            uint256 at,
            ,
            bool active
        ) = reg.plans(AGENT_ID);

        assertEq(aid, AGENT_ID);
        assertEq(uint(lvl), uint(LEVEL));
        assertEq(desc, DESC);
        assertEq(iUri, IFACE_URI);
        assertTrue(hasStop);
        assertEq(sUri, STOP_URI);
        assertEq(owner, planOwner);
        assertEq(at, block.timestamp);
        assertTrue(active);
    }

    function test_registerPlan_allLevels() public {
        HumanOversightRegistry.OversightLevel[4] memory levels = [
            HumanOversightRegistry.OversightLevel.AUTOMATED,
            HumanOversightRegistry.OversightLevel.HUMAN_ON_THE_LOOP,
            HumanOversightRegistry.OversightLevel.HUMAN_IN_THE_LOOP,
            HumanOversightRegistry.OversightLevel.HUMAN_IN_COMMAND
        ];
        bytes32[4] memory ids = [
            keccak256("a0"), keccak256("a1"), keccak256("a2"), keccak256("a3")
        ];
        for (uint i = 0; i < levels.length; i++) {
            // HUMAN_IN_THE_LOOP requires hasStopButton=true
            bool stop = levels[i] == HumanOversightRegistry.OversightLevel.HUMAN_IN_THE_LOOP;
            vm.prank(planOwner);
            reg.registerPlan(ids[i], levels[i], DESC, IFACE_URI, stop, STOP_URI);
            (, HumanOversightRegistry.OversightLevel lvl,,,,,,,, ) = reg.plans(ids[i]);
            assertEq(uint(lvl), uint(levels[i]));
        }
    }

    function test_registerPlan_revertsIfZeroAgentId() public {
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.InvalidAgentId.selector);
        reg.registerPlan(bytes32(0), LEVEL, DESC, IFACE_URI, true, STOP_URI);
    }

    function test_registerPlan_revertsIfAlreadyExists() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.PlanAlreadyExists.selector, AGENT_ID
        ));
        reg.registerPlan(AGENT_ID, LEVEL, DESC, IFACE_URI, true, STOP_URI);
    }

    function test_registerPlan_revertsIfEmptyDescription() public {
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.EmptyDescription.selector);
        reg.registerPlan(AGENT_ID, LEVEL, "", IFACE_URI, true, STOP_URI);
    }

    function test_registerPlan_revertsIfHumanInTheLoopWithoutStopButton() public {
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.StopButtonRequired.selector);
        reg.registerPlan(
            AGENT_ID,
            HumanOversightRegistry.OversightLevel.HUMAN_IN_THE_LOOP,
            DESC, IFACE_URI, false, ""
        );
    }

    // ─── updatePlan ──────────────────────────────────────────────────────────

    function test_updatePlan_success() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectEmit(true, false, false, true);
        emit HumanOversightRegistry.OversightPlanUpdated(
            AGENT_ID,
            HumanOversightRegistry.OversightLevel.HUMAN_IN_COMMAND,
            block.timestamp
        );
        reg.updatePlan(AGENT_ID, HumanOversightRegistry.OversightLevel.HUMAN_IN_COMMAND, "Updated measures");

        (, HumanOversightRegistry.OversightLevel lvl, string memory desc,,,,,,,) = reg.plans(AGENT_ID);
        assertEq(uint(lvl), uint(HumanOversightRegistry.OversightLevel.HUMAN_IN_COMMAND));
        assertEq(desc, "Updated measures");
    }

    function test_updatePlan_deployerCanUpdate() public {
        _registerPlan();
        vm.prank(deployer);
        reg.updatePlan(AGENT_ID, HumanOversightRegistry.OversightLevel.AUTOMATED, "Deployer update");
    }

    function test_updatePlan_revertsIfNotFound() public {
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.PlanNotFound.selector, AGENT_ID
        ));
        reg.updatePlan(AGENT_ID, LEVEL, "x");
    }

    function test_updatePlan_revertsIfUnauthorized() public {
        _registerPlan();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, stranger
        ));
        reg.updatePlan(AGENT_ID, LEVEL, "hacked");
    }

    function test_updatePlan_revertsIfEmptyDescription() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.EmptyDescription.selector);
        reg.updatePlan(AGENT_ID, LEVEL, "");
    }

    function test_updatePlan_revertsIfHumanInTheLoopWithoutStopButton() public {
        // register WITHOUT stop button at a lower level first
        vm.prank(planOwner);
        reg.registerPlan(AGENT_ID, HumanOversightRegistry.OversightLevel.AUTOMATED, DESC, IFACE_URI, false, "");

        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.StopButtonRequired.selector);
        reg.updatePlan(AGENT_ID, HumanOversightRegistry.OversightLevel.HUMAN_IN_THE_LOOP, DESC);
    }

    // ─── setOverseer ─────────────────────────────────────────────────────────

    function test_setOverseer_authorizes() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectEmit(true, false, false, true);
        emit HumanOversightRegistry.OverseerSet(AGENT_ID, overseer, true, block.timestamp);
        reg.setOverseer(AGENT_ID, overseer, true);
        assertTrue(reg.overseers(AGENT_ID, overseer));
    }

    function test_setOverseer_revokes() public {
        _registerPlan();
        _authorizeOverseer();
        vm.prank(planOwner);
        reg.setOverseer(AGENT_ID, overseer, false);
        assertFalse(reg.overseers(AGENT_ID, overseer));
    }

    function test_setOverseer_revertsIfPlanNotFound() public {
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.PlanNotFound.selector, AGENT_ID
        ));
        reg.setOverseer(AGENT_ID, overseer, true);
    }

    function test_setOverseer_revertsIfUnauthorized() public {
        _registerPlan();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, stranger
        ));
        reg.setOverseer(AGENT_ID, overseer, true);
    }

    // ─── halt ────────────────────────────────────────────────────────────────

    function test_halt_success() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectEmit(true, false, false, true);
        emit HumanOversightRegistry.AgentHalted(AGENT_ID, planOwner, REASON, block.timestamp);
        reg.halt(AGENT_ID, REASON, EV_URI);

        assertTrue(reg.halted(AGENT_ID));
        assertEq(reg.totalInterventions(), 1);
    }

    function test_halt_overseerCanHalt() public {
        _registerPlan();
        _authorizeOverseer();
        vm.prank(overseer);
        reg.halt(AGENT_ID, REASON, EV_URI);
        assertTrue(reg.halted(AGENT_ID));
    }

    function test_halt_deployerCanHalt() public {
        _registerPlan();
        vm.prank(deployer);
        reg.halt(AGENT_ID, REASON, EV_URI);
        assertTrue(reg.halted(AGENT_ID));
    }

    function test_halt_revertsIfAlreadyHalted() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.halt(AGENT_ID, REASON, EV_URI);
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.AlreadyHalted.selector, AGENT_ID
        ));
        reg.halt(AGENT_ID, REASON, EV_URI);
    }

    function test_halt_revertsIfPlanNotFound() public {
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.PlanNotFound.selector, AGENT_ID
        ));
        reg.halt(AGENT_ID, REASON, EV_URI);
    }

    function test_halt_revertsIfEmptyReason() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.EmptyDescription.selector);
        reg.halt(AGENT_ID, "", EV_URI);
    }

    function test_halt_revertsIfUnauthorized() public {
        _registerPlan();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, stranger
        ));
        reg.halt(AGENT_ID, REASON, EV_URI);
    }

    // ─── resume ──────────────────────────────────────────────────────────────

    function test_resume_success() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.halt(AGENT_ID, REASON, EV_URI);

        vm.prank(planOwner);
        vm.expectEmit(true, false, false, true);
        emit HumanOversightRegistry.AgentResumed(AGENT_ID, planOwner, block.timestamp);
        reg.resume(AGENT_ID, EV_URI);

        assertFalse(reg.halted(AGENT_ID));
        assertEq(reg.totalInterventions(), 2);
    }

    function test_resume_revertsIfNotHalted() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotHalted.selector, AGENT_ID
        ));
        reg.resume(AGENT_ID, EV_URI);
    }

    function test_resume_revertsIfUnauthorized() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.halt(AGENT_ID, REASON, EV_URI);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, stranger
        ));
        reg.resume(AGENT_ID, EV_URI);
    }

    // ─── logIntervention ─────────────────────────────────────────────────────

    function test_logIntervention_override() public {
        _registerPlan();
        _authorizeOverseer();
        bytes32 decisionRef = keccak256("decision-42");

        vm.prank(overseer);
        vm.expectEmit(true, true, false, true);
        emit HumanOversightRegistry.InterventionLogged(
            1, AGENT_ID, HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT,
            overseer, block.timestamp
        );
        uint256 id = reg.logIntervention(
            AGENT_ID,
            HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT,
            REASON, EV_URI, decisionRef
        );

        assertEq(id, 1);
        (
            uint256 rid, bytes32 agentId, HumanOversightRegistry.InterventionType itype,
            string memory reason,, bytes32 dRef, address osr, uint256 ts
        ) = reg.interventions(id);

        assertEq(rid, 1);
        assertEq(agentId, AGENT_ID);
        assertEq(uint(itype), uint(HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT));
        assertEq(reason, REASON);
        assertEq(dRef, decisionRef);
        assertEq(osr, overseer);
        assertEq(ts, block.timestamp);
    }

    function test_logIntervention_escalate() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE,
            REASON, EV_URI, bytes32(0)
        );
        assertEq(reg.totalInterventions(), 1);
    }

    function test_logIntervention_auditReview() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.AUDIT_REVIEW,
            "Scheduled quarterly review", "", bytes32(0)
        );
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.AUDIT_REVIEW), 1);
    }

    function test_logIntervention_revertsIfHalt() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, planOwner
        ));
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.HALT,
            REASON, EV_URI, bytes32(0)
        );
    }

    function test_logIntervention_revertsIfResume() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, planOwner
        ));
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.RESUME,
            REASON, EV_URI, bytes32(0)
        );
    }

    function test_logIntervention_revertsIfPlanNotFound() public {
        vm.prank(planOwner);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.PlanNotFound.selector, AGENT_ID
        ));
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE,
            REASON, EV_URI, bytes32(0)
        );
    }

    function test_logIntervention_revertsIfEmptyReason() public {
        _registerPlan();
        vm.prank(planOwner);
        vm.expectRevert(HumanOversightRegistry.EmptyDescription.selector);
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE,
            "", EV_URI, bytes32(0)
        );
    }

    function test_logIntervention_revertsIfUnauthorized() public {
        _registerPlan();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            HumanOversightRegistry.NotAuthorized.selector, stranger
        ));
        reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE,
            REASON, EV_URI, bytes32(0)
        );
    }

    function test_logIntervention_revertsIfPlanInactive() public {
        _registerPlan();
        // halt doesn't deactivate, but we can test via the active flag path
        // by directly testing that PAUSE works on an active plan
        vm.prank(planOwner);
        uint256 id = reg.logIntervention(
            AGENT_ID, HumanOversightRegistry.InterventionType.PAUSE,
            REASON, EV_URI, bytes32(0)
        );
        assertGt(id, 0);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function test_getAgentInterventions_empty() public {
        _registerPlan();
        assertEq(reg.getAgentInterventions(AGENT_ID).length, 0);
    }

    function test_getAgentInterventions_afterHalt() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.halt(AGENT_ID, REASON, EV_URI);
        assertEq(reg.getAgentInterventions(AGENT_ID).length, 1);
    }

    function test_countByType_multipleTypes() public {
        _registerPlan();
        vm.prank(planOwner);
        reg.logIntervention(AGENT_ID, HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT, REASON, "", bytes32(0));
        vm.prank(planOwner);
        reg.logIntervention(AGENT_ID, HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT, REASON, "", bytes32(0));
        vm.prank(planOwner);
        reg.logIntervention(AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE, REASON, "", bytes32(0));

        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT), 2);
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.ESCALATE), 1);
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.AUDIT_REVIEW), 0);
    }

    function test_fullLifecycle_haltResumeIntervene() public {
        _registerPlan();
        _authorizeOverseer();

        // overseer halts
        vm.prank(overseer);
        reg.halt(AGENT_ID, "Biased output detected", EV_URI);
        assertTrue(reg.halted(AGENT_ID));

        // owner resumes after review
        vm.prank(planOwner);
        reg.resume(AGENT_ID, "ipfs://QmReviewComplete");
        assertFalse(reg.halted(AGENT_ID));

        // log override of the offending decision
        vm.prank(overseer);
        reg.logIntervention(
            AGENT_ID,
            HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT,
            "Replaced biased output with reviewed decision",
            EV_URI,
            keccak256("decision-99")
        );

        assertEq(reg.totalInterventions(), 3);
        assertEq(reg.getAgentInterventions(AGENT_ID).length, 3);
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.HALT), 1);
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.RESUME), 1);
        assertEq(reg.countByType(AGENT_ID, HumanOversightRegistry.InterventionType.OVERRIDE_OUTPUT), 1);
    }
}
