// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/SystemicRiskRegistry.sol";

contract SystemicRiskRegistryTest is Test {

    SystemicRiskRegistry public reg;

    address owner    = makeAddr("owner");
    address reporter = makeAddr("reporter");
    address stranger = makeAddr("stranger");

    bytes32 constant MODEL_A = keccak256("gpt-x");
    bytes32 constant MODEL_B = keccak256("gpt-y");

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _claim(address who, bytes32 modelId) internal {
        vm.prank(who);
        reg.claimModel(modelId);
    }

    function _eval(address who, bytes32 modelId, SystemicRiskRegistry.EvaluationOutcome outcome)
        internal returns (uint256 id)
    {
        vm.prank(who);
        id = reg.recordEvaluation(modelId, "MITRE ATLAS", "Findings here", outcome, "ipfs://eval");
    }

    function _incident(address who, bytes32 modelId) internal returns (uint256 id) {
        vm.prank(who);
        id = reg.reportIncident(
            modelId,
            SystemicRiskRegistry.IncidentSeverity.HIGH,
            "Model produced harmful output",
            "ipfs://incident",
            block.timestamp
        );
    }

    function _cyber(address who, bytes32 modelId) internal {
        vm.prank(who);
        reg.recordCybersecurityProtection(modelId, "ipfs://measures", "adversarial-attack", false, "");
    }

    function _energy(address who, bytes32 modelId) internal {
        vm.prank(who);
        reg.recordEnergyReport(modelId, 1_000_000, 500, "ipfs://methodology", "ipfs://energy");
    }

    function setUp() public {
        vm.prank(owner);
        reg = new SystemicRiskRegistry();
    }

    // ─── Deployment ──────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), owner);
    }

    function test_counts_startAtZero() public view {
        assertEq(reg.evaluationCount(), 0);
        assertEq(reg.incidentCount(), 0);
    }

    // ─── claimModel ──────────────────────────────────────────────────────────

    function test_claimModel_success() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit SystemicRiskRegistry.ModelOwnerSet(MODEL_A, stranger, block.timestamp);
        vm.prank(stranger);
        reg.claimModel(MODEL_A);
        assertEq(reg.modelOwner(MODEL_A), stranger);
    }

    function test_claimModel_revertsIfZeroId() public {
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.InvalidModelId.selector);
        reg.claimModel(bytes32(0));
    }

    function test_claimModel_revertsIfAlreadyClaimed() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.ModelAlreadyClaimed.selector, MODEL_A)
        );
        reg.claimModel(MODEL_A);
    }

    // ─── setReporter ─────────────────────────────────────────────────────────

    function test_setReporter_authorize() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(reg));
        emit SystemicRiskRegistry.ReporterSet(MODEL_A, reporter, true, block.timestamp);
        reg.setReporter(MODEL_A, reporter, true);
        assertTrue(reg.reporters(MODEL_A, reporter));
    }

    function test_setReporter_revoke() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        reg.setReporter(MODEL_A, reporter, true);
        vm.prank(owner);
        reg.setReporter(MODEL_A, reporter, false);
        assertFalse(reg.reporters(MODEL_A, reporter));
    }

    function test_setReporter_revertsIfNotOwner() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.NotAuthorized.selector, stranger)
        );
        reg.setReporter(MODEL_A, reporter, true);
    }

    // ─── recordEvaluation ─────────────────────────────────────────────────────

    function test_recordEvaluation_pass() public {
        _claim(owner, MODEL_A);
        vm.expectEmit(true, true, false, true, address(reg));
        emit SystemicRiskRegistry.AdversarialEvaluationRecorded(
            1, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS, owner, block.timestamp
        );
        uint256 id = _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        assertEq(id, 1);
        assertEq(reg.evaluationCount(), 1);
    }

    function test_recordEvaluation_fail() public {
        _claim(owner, MODEL_A);
        uint256 id = _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.FAIL);
        assertEq(uint256(reg.getEvaluation(id).outcome), uint256(SystemicRiskRegistry.EvaluationOutcome.FAIL));
    }

    function test_recordEvaluation_populatesFields() public {
        _claim(owner, MODEL_A);
        uint256 id = _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.CONDITIONAL_PASS);
        SystemicRiskRegistry.AdversarialEvaluation memory e = reg.getEvaluation(id);
        assertEq(e.modelId, MODEL_A);
        assertEq(e.methodology, "MITRE ATLAS");
        assertEq(e.findings, "Findings here");
        assertEq(e.reportUri, "ipfs://eval");
        assertEq(e.evaluatedBy, owner);
    }

    function test_recordEvaluation_multipleEvals() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.FAIL);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        assertEq(reg.getEvaluations(MODEL_A).length, 2);
    }

    function test_recordEvaluation_revertsIfEmptyMethodology() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.recordEvaluation(MODEL_A, "", "findings", SystemicRiskRegistry.EvaluationOutcome.PASS, "ipfs://x");
    }

    function test_recordEvaluation_revertsIfEmptyFindings() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.recordEvaluation(MODEL_A, "ATLAS", "", SystemicRiskRegistry.EvaluationOutcome.PASS, "ipfs://x");
    }

    function test_recordEvaluation_revertsIfEmptyUri() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.recordEvaluation(MODEL_A, "ATLAS", "findings", SystemicRiskRegistry.EvaluationOutcome.PASS, "");
    }

    function test_recordEvaluation_revertsIfUnauthorized() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordEvaluation(MODEL_A, "ATLAS", "f", SystemicRiskRegistry.EvaluationOutcome.PASS, "ipfs://x");
    }

    function test_recordEvaluation_reporterCanRecord() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        reg.setReporter(MODEL_A, reporter, true);
        vm.prank(reporter);
        reg.recordEvaluation(MODEL_A, "NIST AI RMF", "f", SystemicRiskRegistry.EvaluationOutcome.PASS, "ipfs://x");
        assertEq(reg.getEvaluations(MODEL_A).length, 1);
    }

    function test_getEvaluation_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.EvaluationNotFound.selector, 99)
        );
        reg.getEvaluation(99);
    }

    // ─── reportIncident ───────────────────────────────────────────────────────

    function test_reportIncident_success() public {
        _claim(owner, MODEL_A);
        vm.expectEmit(true, true, false, true, address(reg));
        emit SystemicRiskRegistry.AIOfficeIncidentReported(
            1, MODEL_A, SystemicRiskRegistry.IncidentSeverity.HIGH, owner, block.timestamp
        );
        uint256 id = _incident(owner, MODEL_A);
        assertEq(id, 1);
        assertEq(reg.incidentCount(), 1);
    }

    function test_reportIncident_populatesFields() public {
        _claim(owner, MODEL_A);
        uint256 id = _incident(owner, MODEL_A);
        SystemicRiskRegistry.AIOfficeIncident memory inc = reg.getIncident(id);
        assertEq(inc.modelId, MODEL_A);
        assertEq(inc.description, "Model produced harmful output");
        assertEq(uint256(inc.severity), uint256(SystemicRiskRegistry.IncidentSeverity.HIGH));
        assertEq(uint256(inc.status), uint256(SystemicRiskRegistry.IncidentStatus.REPORTED));
        assertEq(inc.reportedBy, owner);
    }

    function test_reportIncident_allSeverities() public {
        _claim(owner, MODEL_A);
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(owner);
            reg.reportIncident(MODEL_A, SystemicRiskRegistry.IncidentSeverity(i), "d", "ipfs://i", block.timestamp);
        }
        assertEq(reg.getIncidents(MODEL_A).length, 4);
    }

    function test_reportIncident_revertsIfFutureTimestamp() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.FutureTimestamp.selector, block.timestamp + 1, block.timestamp)
        );
        reg.reportIncident(MODEL_A, SystemicRiskRegistry.IncidentSeverity.LOW, "d", "ipfs://i", block.timestamp + 1);
    }

    function test_reportIncident_revertsIfEmptyDescription() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.reportIncident(MODEL_A, SystemicRiskRegistry.IncidentSeverity.LOW, "", "ipfs://i", block.timestamp);
    }

    function test_reportIncident_revertsIfUnauthorized() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.NotAuthorized.selector, stranger)
        );
        reg.reportIncident(MODEL_A, SystemicRiskRegistry.IncidentSeverity.LOW, "d", "ipfs://i", block.timestamp);
    }

    function test_markUnderReview_success() public {
        _claim(owner, MODEL_A);
        uint256 id = _incident(owner, MODEL_A);
        vm.prank(owner);
        reg.markUnderReview(id);
        assertEq(
            uint256(reg.getIncident(id).status),
            uint256(SystemicRiskRegistry.IncidentStatus.UNDER_REVIEW)
        );
    }

    function test_resolveIncident_success() public {
        _claim(owner, MODEL_A);
        uint256 id = _incident(owner, MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit SystemicRiskRegistry.AIOfficeIncidentResolved(id, "ipfs://resolution", owner, block.timestamp);
        vm.prank(owner);
        reg.resolveIncident(id, "ipfs://resolution");
        assertEq(
            uint256(reg.getIncident(id).status),
            uint256(SystemicRiskRegistry.IncidentStatus.RESOLVED)
        );
        assertEq(reg.getIncident(id).resolutionUri, "ipfs://resolution");
    }

    function test_resolveIncident_revertsIfAlreadyResolved() public {
        _claim(owner, MODEL_A);
        uint256 id = _incident(owner, MODEL_A);
        vm.prank(owner);
        reg.resolveIncident(id, "ipfs://res");
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.IncidentAlreadyResolved.selector, id)
        );
        reg.resolveIncident(id, "ipfs://res2");
    }

    function test_resolveIncident_revertsIfEmptyUri() public {
        _claim(owner, MODEL_A);
        uint256 id = _incident(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.resolveIncident(id, "");
    }

    function test_getIncident_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.IncidentNotFound.selector, 5)
        );
        reg.getIncident(5);
    }

    // ─── recordCybersecurityProtection ────────────────────────────────────────

    function test_recordCybersecurity_success() public {
        _claim(owner, MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit SystemicRiskRegistry.CybersecurityProtectionRecorded(MODEL_A, false, owner, block.timestamp);
        _cyber(owner, MODEL_A);
        SystemicRiskRegistry.CybersecurityProtection memory c = reg.getCybersecurityProtection(MODEL_A);
        assertEq(c.measuresUri, "ipfs://measures");
        assertEq(c.threatModel, "adversarial-attack");
        assertFalse(c.pentestPerformed);
    }

    function test_recordCybersecurity_withPentest() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        reg.recordCybersecurityProtection(MODEL_A, "ipfs://m", "threat", true, "ipfs://pentest");
        SystemicRiskRegistry.CybersecurityProtection memory c = reg.getCybersecurityProtection(MODEL_A);
        assertTrue(c.pentestPerformed);
        assertEq(c.pentestUri, "ipfs://pentest");
    }

    function test_recordCybersecurity_canUpdate() public {
        _claim(owner, MODEL_A);
        _cyber(owner, MODEL_A);
        vm.prank(owner);
        reg.recordCybersecurityProtection(MODEL_A, "ipfs://measures-v2", "all-threats", true, "ipfs://pentest");
        assertEq(reg.getCybersecurityProtection(MODEL_A).measuresUri, "ipfs://measures-v2");
    }

    function test_recordCybersecurity_revertsIfEmptyUri() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.recordCybersecurityProtection(MODEL_A, "", "threat", false, "");
    }

    function test_recordCybersecurity_revertsIfUnauthorized() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordCybersecurityProtection(MODEL_A, "ipfs://m", "threat", false, "");
    }

    // ─── recordEnergyReport ───────────────────────────────────────────────────

    function test_recordEnergyReport_success() public {
        _claim(owner, MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit SystemicRiskRegistry.EnergyReportRecorded(MODEL_A, 1_000_000, 500, owner, block.timestamp);
        _energy(owner, MODEL_A);
        SystemicRiskRegistry.EnergyReport memory er = reg.getEnergyReport(MODEL_A);
        assertEq(er.trainingEnergyKwh, 1_000_000);
        assertEq(er.inferenceEnergyKwhPer1M, 500);
    }

    function test_recordEnergyReport_canUpdate() public {
        _claim(owner, MODEL_A);
        _energy(owner, MODEL_A);
        vm.prank(owner);
        reg.recordEnergyReport(MODEL_A, 2_000_000, 400, "ipfs://m2", "ipfs://energy2");
        assertEq(reg.getEnergyReport(MODEL_A).trainingEnergyKwh, 2_000_000);
    }

    function test_recordEnergyReport_revertsIfEmptyUri() public {
        _claim(owner, MODEL_A);
        vm.prank(owner);
        vm.expectRevert(SystemicRiskRegistry.EmptyField.selector);
        reg.recordEnergyReport(MODEL_A, 1000, 10, "", "ipfs://r");
    }

    function test_recordEnergyReport_revertsIfUnauthorized() public {
        _claim(owner, MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(SystemicRiskRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordEnergyReport(MODEL_A, 1000, 10, "ipfs://m", "ipfs://r");
    }

    // ─── isArt55Compliant ────────────────────────────────────────────────────

    function test_isCompliant_falseWhenNoEvaluation() public {
        _claim(owner, MODEL_A);
        _cyber(owner, MODEL_A);
        _energy(owner, MODEL_A);
        assertFalse(reg.isArt55Compliant(MODEL_A));
    }

    function test_isCompliant_falseWhenAllEvaluationsFail() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.FAIL);
        _cyber(owner, MODEL_A);
        _energy(owner, MODEL_A);
        assertFalse(reg.isArt55Compliant(MODEL_A));
    }

    function test_isCompliant_falseWhenNoCybersecurity() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        _energy(owner, MODEL_A);
        assertFalse(reg.isArt55Compliant(MODEL_A));
    }

    function test_isCompliant_falseWhenNoEnergyReport() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        _cyber(owner, MODEL_A);
        assertFalse(reg.isArt55Compliant(MODEL_A));
    }

    function test_isCompliant_trueWhenAllSatisfied() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        _cyber(owner, MODEL_A);
        _energy(owner, MODEL_A);
        assertTrue(reg.isArt55Compliant(MODEL_A));
    }

    function test_isCompliant_trueWithConditionalPass() public {
        _claim(owner, MODEL_A);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.FAIL);
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.CONDITIONAL_PASS);
        _cyber(owner, MODEL_A);
        _energy(owner, MODEL_A);
        assertTrue(reg.isArt55Compliant(MODEL_A));
    }

    function test_deployerCanActWithoutClaim() public {
        // deployer can record without claiming
        _eval(owner, MODEL_A, SystemicRiskRegistry.EvaluationOutcome.PASS);
        assertEq(reg.evaluationCount(), 1);
    }
}
