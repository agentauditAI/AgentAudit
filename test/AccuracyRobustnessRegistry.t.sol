// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AccuracyRobustnessRegistry.sol";

contract AccuracyRobustnessRegistryTest is Test {

    AccuracyRobustnessRegistry public reg;

    address owner    = makeAddr("owner");
    address assessor = makeAddr("assessor");
    address stranger = makeAddr("stranger");

    bytes32 constant AGENT_A = keccak256("agentA");
    bytes32 constant AGENT_B = keccak256("agentB");

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _claim(address who, bytes32 agentId) internal {
        vm.prank(who);
        reg.claimAgent(agentId);
    }

    function _benchmark(
        address who,
        bytes32 agentId,
        uint16  threshold,
        uint16  achieved
    ) internal returns (uint256 id) {
        vm.prank(who);
        id = reg.recordBenchmark(
            agentId,
            AccuracyRobustnessRegistry.MetricType.ACCURACY,
            "",
            threshold,
            achieved,
            "ipfs://benchmark"
        );
    }

    function _robustness(address who, bytes32 agentId, bool passed) internal {
        vm.prank(who);
        reg.recordRobustnessTest(
            agentId,
            AccuracyRobustnessRegistry.RobustnessTestType.ADVERSARIAL_INPUT,
            passed,
            500,
            "ipfs://robustness"
        );
    }

    function _cyber(address who, bytes32 agentId) internal {
        vm.prank(who);
        reg.recordCybersecurityAssessment(
            agentId,
            AccuracyRobustnessRegistry.CybersecurityLevel.ENHANCED,
            "data-poisoning,model-inversion",
            "ipfs://cyber"
        );
    }

    function setUp() public {
        vm.prank(owner);
        reg = new AccuracyRobustnessRegistry();
    }

    // ─── Deployment ──────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), owner);
    }

    function test_benchmarkCount_startsAtZero() public view {
        assertEq(reg.benchmarkCount(), 0);
    }

    // ─── claimAgent ──────────────────────────────────────────────────────────

    function test_claimAgent_success() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit AccuracyRobustnessRegistry.AgentClaimed(AGENT_A, stranger, block.timestamp);
        vm.prank(stranger);
        reg.claimAgent(AGENT_A);
        assertEq(reg.agentOwner(AGENT_A), stranger);
    }

    function test_claimAgent_revertsIfZeroId() public {
        vm.prank(stranger);
        vm.expectRevert(AccuracyRobustnessRegistry.InvalidAgentId.selector);
        reg.claimAgent(bytes32(0));
    }

    function test_claimAgent_revertsIfAlreadyClaimed() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.AgentAlreadyClaimed.selector, AGENT_A)
        );
        reg.claimAgent(AGENT_A);
    }

    // ─── setAssessor ─────────────────────────────────────────────────────────

    function test_setAssessor_authorize() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(reg));
        emit AccuracyRobustnessRegistry.AssessorSet(AGENT_A, assessor, true, block.timestamp);
        reg.setAssessor(AGENT_A, assessor, true);
        assertTrue(reg.assessors(AGENT_A, assessor));
    }

    function test_setAssessor_revoke() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        reg.setAssessor(AGENT_A, assessor, true);
        vm.prank(owner);
        reg.setAssessor(AGENT_A, assessor, false);
        assertFalse(reg.assessors(AGENT_A, assessor));
    }

    function test_setAssessor_revertsIfNotOwner() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.NotAuthorized.selector, stranger)
        );
        reg.setAssessor(AGENT_A, assessor, true);
    }

    function test_deployerCanSetAssessor() public {
        _claim(stranger, AGENT_A);
        vm.prank(owner); // owner is deployer
        reg.setAssessor(AGENT_A, assessor, true);
        assertTrue(reg.assessors(AGENT_A, assessor));
    }

    // ─── recordBenchmark ─────────────────────────────────────────────────────

    function test_recordBenchmark_passing() public {
        _claim(owner, AGENT_A);
        vm.expectEmit(true, true, false, true, address(reg));
        emit AccuracyRobustnessRegistry.BenchmarkRecorded(
            1, AGENT_A,
            AccuracyRobustnessRegistry.MetricType.ACCURACY,
            9000, 9500,
            AccuracyRobustnessRegistry.BenchmarkStatus.PASSING,
            owner, block.timestamp
        );
        uint256 id = _benchmark(owner, AGENT_A, 9000, 9500);
        assertEq(id, 1);
        assertEq(reg.benchmarkCount(), 1);
    }

    function test_recordBenchmark_failing() public {
        _claim(owner, AGENT_A);
        uint256 id = _benchmark(owner, AGENT_A, 9000, 8000);
        AccuracyRobustnessRegistry.AccuracyBenchmark memory b = reg.getBenchmark(id);
        assertEq(uint256(b.status), uint256(AccuracyRobustnessRegistry.BenchmarkStatus.FAILING));
    }

    function test_recordBenchmark_exactThreshold_passes() public {
        _claim(owner, AGENT_A);
        uint256 id = _benchmark(owner, AGENT_A, 9000, 9000);
        AccuracyRobustnessRegistry.AccuracyBenchmark memory b = reg.getBenchmark(id);
        assertEq(uint256(b.status), uint256(AccuracyRobustnessRegistry.BenchmarkStatus.PASSING));
    }

    function test_recordBenchmark_populatesFields() public {
        _claim(owner, AGENT_A);
        uint256 id = _benchmark(owner, AGENT_A, 9000, 9500);
        AccuracyRobustnessRegistry.AccuracyBenchmark memory b = reg.getBenchmark(id);
        assertEq(b.agentId, AGENT_A);
        assertEq(b.threshold, 9000);
        assertEq(b.achievedValue, 9500);
        assertEq(b.assessedBy, owner);
        assertEq(b.assessmentUri, "ipfs://benchmark");
    }

    function test_recordBenchmark_customMetric() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        uint256 id = reg.recordBenchmark(
            AGENT_A,
            AccuracyRobustnessRegistry.MetricType.CUSTOM,
            "Fairness-Score",
            8000, 8500,
            "ipfs://custom"
        );
        AccuracyRobustnessRegistry.AccuracyBenchmark memory b = reg.getBenchmark(id);
        assertEq(b.metricName, "Fairness-Score");
    }

    function test_recordBenchmark_revertsIfCustomWithEmptyName() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.EmptyField.selector);
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.CUSTOM, "", 8000, 8500, "ipfs://x");
    }

    function test_recordBenchmark_revertsIfInvalidThreshold() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.InvalidScore.selector, 10001)
        );
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.ACCURACY, "", 10001, 9000, "ipfs://x");
    }

    function test_recordBenchmark_revertsIfInvalidAchieved() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.InvalidScore.selector, 10001)
        );
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.ACCURACY, "", 9000, 10001, "ipfs://x");
    }

    function test_recordBenchmark_revertsIfEmptyUri() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.EmptyField.selector);
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.ACCURACY, "", 9000, 9500, "");
    }

    function test_recordBenchmark_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.ACCURACY, "", 9000, 9500, "ipfs://x");
    }

    function test_recordBenchmark_revertsIfZeroAgentId() public {
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.InvalidAgentId.selector);
        reg.recordBenchmark(bytes32(0), AccuracyRobustnessRegistry.MetricType.ACCURACY, "", 9000, 9500, "ipfs://x");
    }

    function test_recordBenchmark_deployerCanRecord() public {
        vm.prank(owner); // deployer, no claim needed
        reg.recordBenchmark(AGENT_B, AccuracyRobustnessRegistry.MetricType.F1_SCORE, "", 8000, 8500, "ipfs://x");
        assertEq(reg.getBenchmarks(AGENT_B).length, 1);
    }

    function test_recordBenchmark_assessorCanRecord() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        reg.setAssessor(AGENT_A, assessor, true);
        vm.prank(assessor);
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.PRECISION, "", 9000, 9200, "ipfs://p");
        assertEq(reg.getBenchmarks(AGENT_A).length, 1);
    }

    function test_recordBenchmark_multipleMetricTypes() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        vm.prank(owner);
        reg.recordBenchmark(AGENT_A, AccuracyRobustnessRegistry.MetricType.F1_SCORE, "", 8500, 8800, "ipfs://f1");
        assertEq(reg.getBenchmarks(AGENT_A).length, 2);
    }

    // ─── recordRobustnessTest ─────────────────────────────────────────────────

    function test_recordRobustnessTest_passed() public {
        _claim(owner, AGENT_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit AccuracyRobustnessRegistry.RobustnessTestRecorded(
            AGENT_A,
            AccuracyRobustnessRegistry.RobustnessTestType.ADVERSARIAL_INPUT,
            true, 500, owner, block.timestamp
        );
        _robustness(owner, AGENT_A, true);
        assertEq(reg.getRobustnessTests(AGENT_A).length, 1);
        assertTrue(reg.getRobustnessTests(AGENT_A)[0].passed);
    }

    function test_recordRobustnessTest_failed() public {
        _claim(owner, AGENT_A);
        _robustness(owner, AGENT_A, false);
        assertFalse(reg.getRobustnessTests(AGENT_A)[0].passed);
    }

    function test_recordRobustnessTest_allTypes() public {
        _claim(owner, AGENT_A);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(owner);
            reg.recordRobustnessTest(
                AGENT_A,
                AccuracyRobustnessRegistry.RobustnessTestType(i),
                true, 300,
                "ipfs://rt"
            );
        }
        assertEq(reg.getRobustnessTests(AGENT_A).length, 5);
    }

    function test_recordRobustnessTest_revertsIfInvalidDegradation() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.InvalidScore.selector, 10001)
        );
        reg.recordRobustnessTest(AGENT_A, AccuracyRobustnessRegistry.RobustnessTestType.STRESS, true, 10001, "ipfs://x");
    }

    function test_recordRobustnessTest_revertsIfEmptyUri() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.EmptyField.selector);
        reg.recordRobustnessTest(AGENT_A, AccuracyRobustnessRegistry.RobustnessTestType.STRESS, true, 300, "");
    }

    function test_recordRobustnessTest_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordRobustnessTest(AGENT_A, AccuracyRobustnessRegistry.RobustnessTestType.NOISE_INJECTION, true, 200, "ipfs://x");
    }

    // ─── recordCybersecurityAssessment ────────────────────────────────────────

    function test_recordCybersecurity_success() public {
        _claim(owner, AGENT_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit AccuracyRobustnessRegistry.CybersecurityAssessed(
            AGENT_A,
            AccuracyRobustnessRegistry.CybersecurityLevel.ENHANCED,
            owner, block.timestamp
        );
        _cyber(owner, AGENT_A);
        AccuracyRobustnessRegistry.CybersecurityAssessment memory c = reg.getCybersecurityAssessment(AGENT_A);
        assertEq(uint256(c.level), uint256(AccuracyRobustnessRegistry.CybersecurityLevel.ENHANCED));
        assertEq(c.threatsAddressed, "data-poisoning,model-inversion");
    }

    function test_recordCybersecurity_canUpdate() public {
        _claim(owner, AGENT_A);
        _cyber(owner, AGENT_A);
        vm.prank(owner);
        reg.recordCybersecurityAssessment(
            AGENT_A,
            AccuracyRobustnessRegistry.CybersecurityLevel.HIGH,
            "all-threats",
            "ipfs://cyber-v2"
        );
        AccuracyRobustnessRegistry.CybersecurityAssessment memory c = reg.getCybersecurityAssessment(AGENT_A);
        assertEq(uint256(c.level), uint256(AccuracyRobustnessRegistry.CybersecurityLevel.HIGH));
    }

    function test_recordCybersecurity_revertsIfEmptyThreats() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.EmptyField.selector);
        reg.recordCybersecurityAssessment(AGENT_A, AccuracyRobustnessRegistry.CybersecurityLevel.BASIC, "", "ipfs://c");
    }

    function test_recordCybersecurity_revertsIfEmptyUri() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(AccuracyRobustnessRegistry.EmptyField.selector);
        reg.recordCybersecurityAssessment(AGENT_A, AccuracyRobustnessRegistry.CybersecurityLevel.BASIC, "threats", "");
    }

    function test_recordCybersecurity_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.NotAuthorized.selector, stranger)
        );
        reg.recordCybersecurityAssessment(AGENT_A, AccuracyRobustnessRegistry.CybersecurityLevel.BASIC, "t", "ipfs://c");
    }

    // ─── meetsAccuracyRequirements ────────────────────────────────────────────

    function test_meetsAccuracy_falseWhenNoBenchmarks() public view {
        assertFalse(reg.meetsAccuracyRequirements(AGENT_A));
    }

    function test_meetsAccuracy_trueWhenAllPassing() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        _benchmark(owner, AGENT_A, 8500, 9000);
        assertTrue(reg.meetsAccuracyRequirements(AGENT_A));
    }

    function test_meetsAccuracy_falseWhenAnyFailing() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500); // passing
        _benchmark(owner, AGENT_A, 9500, 9000); // failing
        assertFalse(reg.meetsAccuracyRequirements(AGENT_A));
    }

    // ─── meetsRobustnessRequirements ──────────────────────────────────────────

    function test_meetsRobustness_falseWhenNoTests() public view {
        assertFalse(reg.meetsRobustnessRequirements(AGENT_A));
    }

    function test_meetsRobustness_trueWhenLatestPassed() public {
        _claim(owner, AGENT_A);
        _robustness(owner, AGENT_A, false); // old failing
        _robustness(owner, AGENT_A, true);  // latest passing
        assertTrue(reg.meetsRobustnessRequirements(AGENT_A));
    }

    function test_meetsRobustness_falseWhenLatestFailed() public {
        _claim(owner, AGENT_A);
        _robustness(owner, AGENT_A, true);  // old passing
        _robustness(owner, AGENT_A, false); // latest failing
        assertFalse(reg.meetsRobustnessRequirements(AGENT_A));
    }

    // ─── isArt15Compliant ────────────────────────────────────────────────────

    function test_isCompliant_falseWhenNoBenchmarks() public {
        _claim(owner, AGENT_A);
        _robustness(owner, AGENT_A, true);
        _cyber(owner, AGENT_A);
        assertFalse(reg.isArt15Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenBenchmarkFailing() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 8000); // failing
        _robustness(owner, AGENT_A, true);
        _cyber(owner, AGENT_A);
        assertFalse(reg.isArt15Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenNoRobustnessTest() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        _cyber(owner, AGENT_A);
        assertFalse(reg.isArt15Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenRobustnessFailed() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        _robustness(owner, AGENT_A, false);
        _cyber(owner, AGENT_A);
        assertFalse(reg.isArt15Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenNoCybersecurity() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        _robustness(owner, AGENT_A, true);
        assertFalse(reg.isArt15Compliant(AGENT_A));
    }

    function test_isCompliant_trueWhenAllSatisfied() public {
        _claim(owner, AGENT_A);
        _benchmark(owner, AGENT_A, 9000, 9500);
        _robustness(owner, AGENT_A, true);
        _cyber(owner, AGENT_A);
        assertTrue(reg.isArt15Compliant(AGENT_A));
    }

    // ─── getBenchmark ────────────────────────────────────────────────────────

    function test_getBenchmark_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(AccuracyRobustnessRegistry.BenchmarkNotFound.selector, 99)
        );
        reg.getBenchmark(99);
    }
}
