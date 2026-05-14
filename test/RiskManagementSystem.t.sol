// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/RiskManagementSystem.sol";

contract RiskManagementSystemTest is Test {

    RiskManagementSystem public rms;

    address deployer  = makeAddr("deployer");
    address owner     = makeAddr("owner");
    address assessor  = makeAddr("assessor");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_ID  = keccak256("agent-001");
    bytes32 constant AGENT_ID2 = keccak256("agent-002");

    string constant DESC      = "Model may produce biased hiring recommendations";
    string constant EV_URI    = "ipfs://QmEvidence123";
    string constant MIT       = "Added fairness constraints and bias testing pipeline";
    string constant DOC_URI   = "ipfs://QmMitigationDoc";
    string constant TEST_DESC = "Bias benchmark on protected attributes";
    string constant RESULT    = "ipfs://QmTestResults";

    RiskManagementSystem.RiskCategory constant CAT = RiskManagementSystem.RiskCategory.BIAS;
    RiskManagementSystem.Severity     constant SEV = RiskManagementSystem.Severity.HIGH;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        rms = new RiskManagementSystem();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _claim() internal {
        vm.prank(owner);
        rms.claimAgent(AGENT_ID);
    }

    function _identify() internal returns (uint256) {
        vm.prank(owner);
        return rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
    }

    function _assess(uint256 id) internal {
        vm.prank(owner);
        rms.assessRisk(id, SEV, 4000, 8000);
    }

    function _mitigate(uint256 id) internal {
        vm.prank(owner);
        rms.recordMitigation(id, MIT, DOC_URI);
    }

    function _test(uint256 id, bool passed) internal {
        vm.prank(owner);
        rms.recordTest(id, TEST_DESC, passed, RESULT);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(rms.deployer(), deployer);
    }

    function test_riskCount_startsAtZero() public view {
        assertEq(rms.riskCount(), 0);
    }

    // ─── claimAgent ──────────────────────────────────────────────────────────

    function test_claimAgent_success() public {
        _claim();
        assertEq(rms.agentOwner(AGENT_ID), owner);
    }

    function test_claimAgent_revertsIfZeroId() public {
        vm.prank(owner);
        vm.expectRevert(RiskManagementSystem.InvalidAgentId.selector);
        rms.claimAgent(bytes32(0));
    }

    function test_claimAgent_revertsIfAlreadyClaimed() public {
        _claim();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AgentAlreadyOwned.selector, AGENT_ID));
        rms.claimAgent(AGENT_ID);
    }

    // ─── setAssessor ─────────────────────────────────────────────────────────

    function test_setAssessor_authorizes() public {
        _claim();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RiskManagementSystem.AssessorSet(AGENT_ID, assessor, true, block.timestamp);
        rms.setAssessor(AGENT_ID, assessor, true);
        assertTrue(rms.assessors(AGENT_ID, assessor));
    }

    function test_setAssessor_revokes() public {
        _claim();
        vm.prank(owner);
        rms.setAssessor(AGENT_ID, assessor, true);
        vm.prank(owner);
        rms.setAssessor(AGENT_ID, assessor, false);
        assertFalse(rms.assessors(AGENT_ID, assessor));
    }

    function test_setAssessor_deployerCanAct() public {
        _claim();
        vm.prank(deployer);
        rms.setAssessor(AGENT_ID, assessor, true);
        assertTrue(rms.assessors(AGENT_ID, assessor));
    }

    function test_setAssessor_revertsIfUnauthorized() public {
        _claim();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.setAssessor(AGENT_ID, assessor, true);
    }

    // ─── identifyRisk ────────────────────────────────────────────────────────

    function test_identifyRisk_success() public {
        _claim();
        uint256 id = _identify();
        assertEq(id, 1);
        assertEq(rms.riskCount(), 1);

        (
            uint256 rid, bytes32 agentId, RiskManagementSystem.RiskCategory cat,
            RiskManagementSystem.Severity sev, RiskManagementSystem.RiskStatus status,
            string memory desc,,,, address by, uint256 at,
        ) = rms.risks(id);

        assertEq(rid, 1);
        assertEq(agentId, AGENT_ID);
        assertEq(uint(cat), uint(CAT));
        assertEq(uint(sev), uint(RiskManagementSystem.Severity.MEDIUM));
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.IDENTIFIED));
        assertEq(desc, DESC);
        assertEq(by, owner);
        assertEq(at, block.timestamp);
    }

    function test_identifyRisk_emitsEvent() public {
        _claim();
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit RiskManagementSystem.RiskIdentified(1, AGENT_ID, CAT, owner, block.timestamp);
        rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
    }

    function test_identifyRisk_appendsToAgentRisks() public {
        _claim();
        _identify();
        _identify();
        uint256[] memory ids = rms.getAgentRisks(AGENT_ID);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_identifyRisk_assessorCanIdentify() public {
        _claim();
        vm.prank(owner);
        rms.setAssessor(AGENT_ID, assessor, true);
        vm.prank(assessor);
        uint256 id = rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
        assertEq(id, 1);
    }

    function test_identifyRisk_deployerCanIdentify() public {
        _claim();
        vm.prank(deployer);
        uint256 id = rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
        assertEq(id, 1);
    }

    function test_identifyRisk_revertsIfZeroAgentId() public {
        vm.prank(owner);
        vm.expectRevert(RiskManagementSystem.InvalidAgentId.selector);
        rms.identifyRisk(bytes32(0), CAT, DESC, EV_URI);
    }

    function test_identifyRisk_revertsIfEmptyDescription() public {
        _claim();
        vm.prank(owner);
        vm.expectRevert(RiskManagementSystem.EmptyDescription.selector);
        rms.identifyRisk(AGENT_ID, CAT, "", EV_URI);
    }

    function test_identifyRisk_revertsIfUnauthorized() public {
        _claim();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
    }

    function test_identifyRisk_noClaimNeeded_deployerOnly() public {
        // deployer can identify even on an unclaimed agent
        vm.prank(deployer);
        uint256 id = rms.identifyRisk(AGENT_ID, CAT, DESC, EV_URI);
        assertEq(id, 1);
    }

    // ─── assessRisk ──────────────────────────────────────────────────────────

    function test_assessRisk_success() public {
        _claim();
        uint256 id = _identify();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RiskManagementSystem.RiskAssessed(id, SEV, 4000, 8000, block.timestamp);
        rms.assessRisk(id, SEV, 4000, 8000);

        (,,,RiskManagementSystem.Severity sev, RiskManagementSystem.RiskStatus status,,, uint16 l, uint16 imp,,, ) = rms.risks(id);
        assertEq(uint(sev), uint(SEV));
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.ASSESSED));
        assertEq(l, 4000);
        assertEq(imp, 8000);
    }

    function test_assessRisk_doesNotDowngradeStatus() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        // re-assess should not downgrade MITIGATED → ASSESSED
        vm.prank(owner);
        rms.assessRisk(id, RiskManagementSystem.Severity.LOW, 1000, 1000);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.MITIGATED));
    }

    function test_assessRisk_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.RiskNotFound.selector, 99));
        rms.assessRisk(99, SEV, 5000, 5000);
    }

    function test_assessRisk_revertsIfClosed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        rms.closeRisk(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AlreadyClosed.selector, id));
        rms.assessRisk(id, SEV, 5000, 5000);
    }

    function test_assessRisk_revertsOnInvalidLikelihood() public {
        _claim();
        uint256 id = _identify();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.InvalidLikelihood.selector, uint16(10001)));
        rms.assessRisk(id, SEV, 10001, 5000);
    }

    function test_assessRisk_revertsOnInvalidImpact() public {
        _claim();
        uint256 id = _identify();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.InvalidImpact.selector, uint16(10001)));
        rms.assessRisk(id, SEV, 5000, 10001);
    }

    function test_assessRisk_revertsIfUnauthorized() public {
        _claim();
        uint256 id = _identify();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.assessRisk(id, SEV, 5000, 5000);
    }

    // ─── recordMitigation ────────────────────────────────────────────────────

    function test_recordMitigation_success() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RiskManagementSystem.MitigationRecorded(id, MIT, owner, block.timestamp);
        rms.recordMitigation(id, MIT, DOC_URI);

        RiskManagementSystem.MitigationRecord[] memory mits = rms.getMitigations(id);
        assertEq(mits.length, 1);
        assertEq(mits[0].measure, MIT);
        assertEq(mits[0].documentUri, DOC_URI);
        assertEq(mits[0].recordedBy, owner);
    }

    function test_recordMitigation_advancesStatus() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.MITIGATED));
    }

    function test_recordMitigation_fromIdentifiedAdvancesToMitigated() public {
        _claim();
        uint256 id = _identify();
        _mitigate(id);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.MITIGATED));
    }

    function test_recordMitigation_multipleMitigations() public {
        _claim();
        uint256 id = _identify();
        _mitigate(id);
        vm.prank(owner);
        rms.recordMitigation(id, "Second measure", "ipfs://doc2");
        assertEq(rms.getMitigations(id).length, 2);
    }

    function test_recordMitigation_revertsIfEmptyMeasure() public {
        _claim();
        uint256 id = _identify();
        vm.prank(owner);
        vm.expectRevert(RiskManagementSystem.EmptyDescription.selector);
        rms.recordMitigation(id, "", DOC_URI);
    }

    function test_recordMitigation_revertsIfClosed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        rms.closeRisk(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AlreadyClosed.selector, id));
        rms.recordMitigation(id, MIT, DOC_URI);
    }

    function test_recordMitigation_revertsIfUnauthorized() public {
        _claim();
        uint256 id = _identify();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.recordMitigation(id, MIT, DOC_URI);
    }

    // ─── recordTest ──────────────────────────────────────────────────────────

    function test_recordTest_passed_advancesToTested() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RiskManagementSystem.TestRecorded(id, true, owner, block.timestamp);
        rms.recordTest(id, TEST_DESC, true, RESULT);

        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.TESTED));
    }

    function test_recordTest_failed_doesNotAdvance() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, false);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.MITIGATED));
    }

    function test_recordTest_storesRecord() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);

        RiskManagementSystem.TestRecord[] memory ts = rms.getTests(id);
        assertEq(ts.length, 1);
        assertEq(ts[0].testDescription, TEST_DESC);
        assertTrue(ts[0].passed);
        assertEq(ts[0].resultUri, RESULT);
        assertEq(ts[0].testedBy, owner);
    }

    function test_recordTest_revertsIfEmptyDescription() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        vm.prank(owner);
        vm.expectRevert(RiskManagementSystem.EmptyDescription.selector);
        rms.recordTest(id, "", true, RESULT);
    }

    function test_recordTest_revertsIfClosed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        rms.closeRisk(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AlreadyClosed.selector, id));
        rms.recordTest(id, TEST_DESC, true, RESULT);
    }

    function test_recordTest_revertsIfUnauthorized() public {
        _claim();
        uint256 id = _identify();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.recordTest(id, TEST_DESC, true, RESULT);
    }

    // ─── markResidual ────────────────────────────────────────────────────────

    function test_markResidual_fromAssessed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        vm.prank(owner);
        rms.markResidual(id);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.RESIDUAL));
    }

    function test_markResidual_revertsFromIdentified() public {
        _claim();
        uint256 id = _identify();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(
            RiskManagementSystem.InvalidStatusTransition.selector,
            RiskManagementSystem.RiskStatus.IDENTIFIED,
            RiskManagementSystem.RiskStatus.RESIDUAL
        ));
        rms.markResidual(id);
    }

    function test_markResidual_revertsIfClosed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        rms.closeRisk(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AlreadyClosed.selector, id));
        rms.markResidual(id);
    }

    function test_markResidual_revertsIfUnauthorized() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.markResidual(id);
    }

    // ─── closeRisk ───────────────────────────────────────────────────────────

    function test_closeRisk_fromTested() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RiskManagementSystem.RiskStatusChanged(
            id,
            RiskManagementSystem.RiskStatus.TESTED,
            RiskManagementSystem.RiskStatus.CLOSED,
            owner,
            block.timestamp
        );
        rms.closeRisk(id);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.CLOSED));
    }

    function test_closeRisk_fromResidual() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        vm.prank(owner);
        rms.markResidual(id);
        vm.prank(owner);
        rms.closeRisk(id);
        (,,,,RiskManagementSystem.RiskStatus status,,,,,,, ) = rms.risks(id);
        assertEq(uint(status), uint(RiskManagementSystem.RiskStatus.CLOSED));
    }

    function test_closeRisk_revertsFromMitigated() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(
            RiskManagementSystem.InvalidStatusTransition.selector,
            RiskManagementSystem.RiskStatus.MITIGATED,
            RiskManagementSystem.RiskStatus.CLOSED
        ));
        rms.closeRisk(id);
    }

    function test_closeRisk_revertsIfAlreadyClosed() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(owner);
        rms.closeRisk(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.AlreadyClosed.selector, id));
        rms.closeRisk(id);
    }

    function test_closeRisk_revertsIfUnauthorized() public {
        _claim();
        uint256 id = _identify();
        _assess(id);
        _mitigate(id);
        _test(id, true);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.NotAuthorized.selector, stranger));
        rms.closeRisk(id);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function test_getMitigations_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.RiskNotFound.selector, 99));
        rms.getMitigations(99);
    }

    function test_getTests_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(RiskManagementSystem.RiskNotFound.selector, 99));
        rms.getTests(99);
    }

    function test_openRiskCount_excludesClosed() public {
        _claim();
        uint256 id1 = _identify();
        _identify();
        _assess(id1);
        _mitigate(id1);
        _test(id1, true);
        vm.prank(owner);
        rms.closeRisk(id1);
        assertEq(rms.openRiskCount(AGENT_ID), 1);
    }

    function test_risksAboveSeverity() public {
        _claim();
        uint256 idHigh = _identify();
        uint256 idLow  = _identify();
        vm.prank(owner);
        rms.assessRisk(idHigh, RiskManagementSystem.Severity.HIGH, 5000, 8000);
        vm.prank(owner);
        rms.assessRisk(idLow, RiskManagementSystem.Severity.LOW, 1000, 1000);

        assertEq(rms.risksAboveSeverity(AGENT_ID, RiskManagementSystem.Severity.HIGH), 1);
        assertEq(rms.risksAboveSeverity(AGENT_ID, RiskManagementSystem.Severity.LOW), 2);
        assertEq(rms.risksAboveSeverity(AGENT_ID, RiskManagementSystem.Severity.CRITICAL), 0);
    }

    // ─── All risk categories ─────────────────────────────────────────────────

    function test_identifyRisk_allCategories() public {
        _claim();
        RiskManagementSystem.RiskCategory[7] memory cats = [
            RiskManagementSystem.RiskCategory.ACCURACY,
            RiskManagementSystem.RiskCategory.BIAS,
            RiskManagementSystem.RiskCategory.SECURITY,
            RiskManagementSystem.RiskCategory.PRIVACY,
            RiskManagementSystem.RiskCategory.SAFETY,
            RiskManagementSystem.RiskCategory.OPERATIONAL,
            RiskManagementSystem.RiskCategory.LEGAL
        ];
        for (uint i = 0; i < cats.length; i++) {
            vm.prank(owner);
            uint256 id = rms.identifyRisk(AGENT_ID, cats[i], DESC, "");
            (,, RiskManagementSystem.RiskCategory cat,,,,,,,,, ) = rms.risks(id);
            assertEq(uint(cat), uint(cats[i]));
        }
    }
}
