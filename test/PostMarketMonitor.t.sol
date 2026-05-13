// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/PostMarketMonitor.sol";

contract PostMarketMonitorTest is Test {

    PostMarketMonitor public monitor;

    address owner    = makeAddr("owner");
    address agent    = makeAddr("agent");
    address reporter = makeAddr("reporter");
    address stranger = makeAddr("stranger");

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        monitor = new PostMarketMonitor();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _enroll() internal {
        vm.prank(owner);
        monitor.enroll(agent, "TestSystem", "HR", 30);
    }

    function _authorizeReporter() internal {
        vm.prank(owner);
        monitor.setReporter(agent, reporter, true);
    }

    function _recordMetric(
        PostMarketMonitor.MetricType mtype,
        int256 value,
        int256 threshold
    ) internal {
        vm.prank(reporter);
        monitor.recordMetric(agent, mtype, "test_metric", value, threshold, "ctx", bytes32(0));
    }

    // ─── Enrollment ──────────────────────────────────────────────────────────

    function test_enroll_success() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PostMarketMonitor.AgentEnrolled(agent, owner, "TestSystem", "HR", 30, block.timestamp);
        monitor.enroll(agent, "TestSystem", "HR", 30);

        (
            address a, address o, string memory name, string memory cat,
            uint256 interval,,,bool active
        ) = monitor.plans(agent);

        assertEq(a, agent);
        assertEq(o, owner);
        assertEq(name, "TestSystem");
        assertEq(cat, "HR");
        assertEq(interval, 30);
        assertTrue(active);
    }

    function test_enroll_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit PostMarketMonitor.AgentEnrolled(agent, owner, "S", "HR", 7, block.timestamp);
        monitor.enroll(agent, "S", "HR", 7);
    }

    function test_enroll_revertsIfAlreadyEnrolled() public {
        _enroll();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.AlreadyEnrolled.selector, agent));
        monitor.enroll(agent, "TestSystem", "HR", 30);
    }

    function test_enroll_revertsIfZeroInterval() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.InvalidInterval.selector, 0));
        monitor.enroll(agent, "TestSystem", "HR", 0);
    }

    function test_enroll_multipleAgents() public {
        address agent2 = makeAddr("agent2");
        vm.startPrank(owner);
        monitor.enroll(agent,  "System A", "HR",         30);
        monitor.enroll(agent2, "System B", "Healthcare", 7);
        vm.stopPrank();

        (address a1,,,,,,, bool active1) = monitor.plans(agent);
        (address a2,,,,,,, bool active2) = monitor.plans(agent2);
        assertEq(a1, agent);
        assertEq(a2, agent2);
        assertTrue(active1);
        assertTrue(active2);

        address[] memory enrolled = monitor.getEnrolledAgents();
        assertEq(enrolled.length, 2);
    }

    // ─── Reporter Management ─────────────────────────────────────────────────

    function test_setReporter_authorizes() public {
        _enroll();
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PostMarketMonitor.ReporterAuthorized(agent, reporter, true, block.timestamp);
        monitor.setReporter(agent, reporter, true);
        assertTrue(monitor.reporters(agent, reporter));
    }

    function test_setReporter_revokes() public {
        _enroll();
        _authorizeReporter();
        vm.prank(owner);
        monitor.setReporter(agent, reporter, false);
        assertFalse(monitor.reporters(agent, reporter));
    }

    function test_setReporter_revertsIfNotOwner() public {
        _enroll();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotOwner.selector, stranger, owner));
        monitor.setReporter(agent, reporter, true);
    }

    function test_setReporter_revertsIfNotEnrolled() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotEnrolled.selector, agent));
        monitor.setReporter(agent, reporter, true);
    }

    // ─── Metric Recording ────────────────────────────────────────────────────

    function test_recordMetric_byOwner() public {
        _enroll();
        vm.prank(owner);
        monitor.recordMetric(
            agent,
            PostMarketMonitor.MetricType.ERROR_RATE,
            "error_rate_7d",
            500,
            1000,
            "v1.0",
            bytes32(0)
        );
        assertEq(monitor.getMetricCount(agent), 1);
    }

    function test_recordMetric_byReporter() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordMetric(
            agent,
            PostMarketMonitor.MetricType.DRIFT_SCORE,
            "drift_score",
            200,
            500,
            "ctx",
            bytes32(0)
        );
        assertEq(monitor.getMetricCount(agent), 1);
    }

    function test_recordMetric_emitsEvent() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        vm.expectEmit(true, true, false, false);
        emit PostMarketMonitor.MetricRecorded(
            agent,
            PostMarketMonitor.MetricType.ERROR_RATE,
            "error_rate",
            500, 1000,
            PostMarketMonitor.AlertLevel.NONE,
            block.timestamp
        );
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "error_rate", 500, 1000, "", bytes32(0));
    }

    function test_recordMetric_revertsIfStranger() public {
        _enroll();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotReporter.selector, stranger, agent));
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "m", 1, 1, "", bytes32(0));
    }

    function test_recordMetric_revertsIfNotEnrolled() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotEnrolled.selector, agent));
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "m", 1, 1, "", bytes32(0));
    }

    function test_recordMetric_revertsIfInactive() public {
        _enroll();
        vm.prank(owner);
        monitor.deactivate(agent, "test");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.PlanInactive.selector, agent));
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "m", 1, 1, "", bytes32(0));
    }

    function test_recordMetric_multipleMetrics() public {
        _enroll();
        _authorizeReporter();
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(reporter);
            monitor.recordMetric(
                agent, PostMarketMonitor.MetricType.LATENCY_MS,
                "latency", int256(i * 100), 500, "", bytes32(0)
            );
        }
        assertEq(monitor.getMetricCount(agent), 10);
    }

    // ─── Alert Level Logic ───────────────────────────────────────────────────

    function test_alertLevel_none_errorRate() public {
        _enroll();
        _authorizeReporter();
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 500, 1000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.NONE));
    }

    function test_alertLevel_low_errorRate() public {
        _enroll();
        _authorizeReporter();
        // 5% over threshold → LOW
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 1050, 1000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.LOW));
    }

    function test_alertLevel_medium_errorRate() public {
        _enroll();
        _authorizeReporter();
        // 100% over → MEDIUM
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 2000, 1000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.MEDIUM));
    }

    function test_alertLevel_high_errorRate() public {
        _enroll();
        _authorizeReporter();
        // 500% over → HIGH
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 6000, 1000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.HIGH));
    }

    function test_alertLevel_critical_errorRate() public {
        _enroll();
        _authorizeReporter();
        // >1000% over → CRITICAL
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 20000, 1000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.CRITICAL));
    }

    function test_alertLevel_none_complianceScore() public {
        _enroll();
        _authorizeReporter();
        // score above threshold → NONE
        _recordMetric(PostMarketMonitor.MetricType.COMPLIANCE_SCORE, 9000, 8000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.NONE));
    }

    function test_alertLevel_low_complianceScore() public {
        _enroll();
        _authorizeReporter();
        // 200 below threshold → LOW
        _recordMetric(PostMarketMonitor.MetricType.COMPLIANCE_SCORE, 7800, 8000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.LOW));
    }

    function test_alertLevel_critical_complianceScore() public {
        _enroll();
        _authorizeReporter();
        // 5000 below threshold → CRITICAL
        _recordMetric(PostMarketMonitor.MetricType.COMPLIANCE_SCORE, 3000, 8000);
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(uint256(recs[0].alertLevel), uint256(PostMarketMonitor.AlertLevel.CRITICAL));
    }

    function test_alertTriggered_emitted_onMedium() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        vm.expectEmit(true, true, false, false);
        emit PostMarketMonitor.AlertTriggered(
            agent, PostMarketMonitor.AlertLevel.MEDIUM, "m", 2000, 1000, block.timestamp
        );
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "m", 2000, 1000, "", bytes32(0));
    }

    function test_alertNotEmitted_onNone() public {
        _enroll();
        _authorizeReporter();
        // Should NOT emit AlertTriggered
        vm.recordLogs();
        vm.prank(reporter);
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.ERROR_RATE, "m", 500, 1000, "", bytes32(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // Only MetricRecorded, no AlertTriggered
        assertEq(logs.length, 1);
    }

    // ─── Summary Updates ─────────────────────────────────────────────────────

    function test_summary_updatesOnMetric() public {
        _enroll();
        _authorizeReporter();
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 2000, 1000); // MEDIUM
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 20000, 1000); // CRITICAL

        (uint256 total, uint256 low, uint256 med, uint256 high, uint256 crit,,) =
            monitor.summaries(agent);

        assertEq(total, 2);
        assertEq(low,   0);
        assertEq(med,   1);
        assertEq(high,  0);
        assertEq(crit,  1);
    }

    function test_summary_updatesComplianceScore() public {
        _enroll();
        _authorizeReporter();
        _recordMetric(PostMarketMonitor.MetricType.COMPLIANCE_SCORE, 9200, 8000);

        (,,,,,int256 score,) = monitor.summaries(agent);
        assertEq(score, 9200);
    }

    // ─── Review ──────────────────────────────────────────────────────────────

    function test_recordReview_success() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        vm.expectEmit(true, true, false, true);
        emit PostMarketMonitor.ReviewCompleted(agent, reporter, 9500, "All good", block.timestamp);
        monitor.recordReview(agent, 9500, "All good");

        (,,,,,int256 score,) = monitor.summaries(agent);
        assertEq(score, 9500);
    }

    function test_recordReview_updatesLastReviewAt() public {
        _enroll();
        _authorizeReporter();
        vm.warp(block.timestamp + 10 days);
        vm.prank(reporter);
        monitor.recordReview(agent, 8000, "ok");

        (,,,,,uint256 lastReview,) = monitor.plans(agent);
        assertEq(lastReview, block.timestamp);
    }

    function test_recordReview_revertsOnInvalidScore_high() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.InvalidScore.selector, 10001));
        monitor.recordReview(agent, 10001, "bad");
    }

    function test_recordReview_revertsOnInvalidScore_negative() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.InvalidScore.selector, -1));
        monitor.recordReview(agent, -1, "bad");
    }

    function test_recordReview_borderScore_zero() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordReview(agent, 0, "critical");
        (,,,,,int256 score,) = monitor.summaries(agent);
        assertEq(score, 0);
    }

    function test_recordReview_borderScore_max() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordReview(agent, 10000, "perfect");
        (,,,,,int256 score,) = monitor.summaries(agent);
        assertEq(score, 10000);
    }

    // ─── Review Due ──────────────────────────────────────────────────────────

    function test_isReviewDue_notDue() public {
        _enroll();
        (bool due,) = monitor.isReviewDue(agent);
        assertFalse(due);
    }

    function test_isReviewDue_exactlyDue() public {
        _enroll();
        vm.warp(block.timestamp + 30 days);
        (bool due, uint256 overdue) = monitor.isReviewDue(agent);
        assertTrue(due);
        assertEq(overdue, 0);
    }

    function test_isReviewDue_overdue() public {
        _enroll();
        vm.warp(block.timestamp + 40 days);
        (bool due, uint256 overdue) = monitor.isReviewDue(agent);
        assertTrue(due);
        assertEq(overdue, 10 days);
    }

    function test_isReviewDue_resetAfterReview() public {
        _enroll();
        _authorizeReporter();
        vm.warp(block.timestamp + 40 days);
        vm.prank(reporter);
        monitor.recordReview(agent, 9000, "done");
        (bool due,) = monitor.isReviewDue(agent);
        assertFalse(due);
    }

    // ─── Deactivate ──────────────────────────────────────────────────────────

    function test_deactivate_success() public {
        _enroll();
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PostMarketMonitor.PlanDeactivated(agent, owner, "retired", block.timestamp);
        monitor.deactivate(agent, "retired");

        (,,,,,,,bool active) = monitor.plans(agent);
        assertFalse(active);
    }

    function test_deactivate_revertsIfNotOwner() public {
        _enroll();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotOwner.selector, stranger, owner));
        monitor.deactivate(agent, "reason");
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    function test_getMetrics_empty() public {
        _enroll();
        PostMarketMonitor.MetricRecord[] memory recs = monitor.getMetrics(agent);
        assertEq(recs.length, 0);
    }

    function test_getMetrics_revertsIfNotEnrolled() public {
        vm.expectRevert(abi.encodeWithSelector(PostMarketMonitor.NotEnrolled.selector, agent));
        monitor.getMetrics(agent);
    }

    function test_getRecentMetrics_all() public {
        _enroll();
        _authorizeReporter();
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(reporter);
            monitor.recordMetric(agent, PostMarketMonitor.MetricType.LATENCY_MS, "lat", int256(i), 1000, "", bytes32(0));
        }
        PostMarketMonitor.MetricRecord[] memory recent = monitor.getRecentMetrics(agent, 5);
        assertEq(recent.length, 5);
    }

    function test_getRecentMetrics_partial() public {
        _enroll();
        _authorizeReporter();
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(reporter);
            monitor.recordMetric(agent, PostMarketMonitor.MetricType.LATENCY_MS, "lat", int256(i), 1000, "", bytes32(0));
        }
        PostMarketMonitor.MetricRecord[] memory recent = monitor.getRecentMetrics(agent, 3);
        assertEq(recent.length, 3);
        assertEq(recent[2].value, 9);
    }

    function test_getRecentMetrics_moreThanExists() public {
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordMetric(agent, PostMarketMonitor.MetricType.LATENCY_MS, "lat", 100, 1000, "", bytes32(0));
        PostMarketMonitor.MetricRecord[] memory recent = monitor.getRecentMetrics(agent, 100);
        assertEq(recent.length, 1);
    }

    function test_getAlerts_filtersCorrectly() public {
        _enroll();
        _authorizeReporter();
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 500,   1000); // NONE
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 1050,  1000); // LOW
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 2000,  1000); // MEDIUM
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 6000,  1000); // HIGH
        _recordMetric(PostMarketMonitor.MetricType.ERROR_RATE, 20000, 1000); // CRITICAL

        PostMarketMonitor.MetricRecord[] memory medAndAbove =
            monitor.getAlerts(agent, PostMarketMonitor.AlertLevel.MEDIUM);
        assertEq(medAndAbove.length, 3);

        PostMarketMonitor.MetricRecord[] memory critOnly =
            monitor.getAlerts(agent, PostMarketMonitor.AlertLevel.CRITICAL);
        assertEq(critOnly.length, 1);
    }

    function test_getEnrolledAgents() public {
        address a1 = makeAddr("a1");
        address a2 = makeAddr("a2");
        address a3 = makeAddr("a3");
        vm.startPrank(owner);
        monitor.enroll(a1, "S1", "HR", 7);
        monitor.enroll(a2, "S2", "Healthcare", 14);
        monitor.enroll(a3, "S3", "Finance", 30);
        vm.stopPrank();

        address[] memory all = monitor.getEnrolledAgents();
        assertEq(all.length, 3);
        assertEq(all[0], a1);
        assertEq(all[1], a2);
        assertEq(all[2], a3);
    }

    function test_deployer_set() public view {
        assertEq(monitor.deployer(), address(this));
    }

    // ─── Fuzz ────────────────────────────────────────────────────────────────

    function testFuzz_enroll_anyInterval(uint256 interval) public {
        vm.assume(interval > 0 && interval < 3650);
        vm.prank(owner);
        monitor.enroll(agent, "FuzzSystem", "Finance", interval);
        (,,,, uint256 stored,,,) = monitor.plans(agent);
        assertEq(stored, interval);
    }

    function testFuzz_recordReview_validScore(int256 score) public {
        vm.assume(score >= 0 && score <= 10000);
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordReview(agent, score, "fuzz");
        (,,,,,int256 stored,) = monitor.summaries(agent);
        assertEq(stored, score);
    }

    function testFuzz_recordMetric_anyValue(int256 value, int256 threshold) public {
        vm.assume(threshold > 0 && threshold < type(int128).max);
        vm.assume(value >= 0 && value < type(int128).max);
        _enroll();
        _authorizeReporter();
        vm.prank(reporter);
        monitor.recordMetric(
            agent, PostMarketMonitor.MetricType.ERROR_RATE,
            "fuzz_metric", value, threshold, "", bytes32(0)
        );
        assertEq(monitor.getMetricCount(agent), 1);
    }
}
