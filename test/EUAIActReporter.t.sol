// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/EUAIActReporter.sol";
import "../contracts/v2/AgentIdentityRegistry.sol";
import "../contracts/v2/AgentRegistration.sol";
import "../contracts/v2/AuditVault.sol";

contract EUAIActReporterTest is Test {

    // Redeclared for vm.expectEmit
    event ComplianceReportGenerated(
        uint256                          indexed reportId,
        uint256                                  agentsCount,
        uint256                                  highRiskCount,
        EUAIActReporter.ComplianceStatus         complianceStatus,
        uint256                                  timestamp
    );

    EUAIActReporter       public reporter;
    AgentIdentityRegistry public registry;
    AgentRegistration     public agentReg;
    AuditVault            public vault;

    address public dev   = address(0xDEAD);
    address public dev2  = address(0xBEEF);
    address public agentA = address(0x1111);
    address public agentB = address(0x2222);
    address public agentC = address(0x3333);

    bytes32 constant CAP_HASH  = keccak256("cap-v1");
    bytes32 constant ROOT1     = keccak256("root1");
    bytes32 constant ROOT2     = keccak256("root2");
    bytes32 constant ROOT3     = keccak256("root3");
    bytes32 constant INPUT_HASH  = keccak256("input");
    bytes32 constant POLICY_HASH = keccak256("policy");

    function setUp() public {
        agentReg = new AgentRegistration();
        registry = new AgentIdentityRegistry(address(agentReg));
        vault    = new AuditVault();
        reporter = new EUAIActReporter(address(registry), address(vault));
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    function test_Constructor_Reverts_ZeroIdentityRegistry() public {
        vm.expectRevert("EUAIActReporter: zero identityRegistry");
        new EUAIActReporter(address(0), address(vault));
    }

    function test_Constructor_Reverts_ZeroAuditVault() public {
        vm.expectRevert("EUAIActReporter: zero auditVault");
        new EUAIActReporter(address(registry), address(0));
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    function _registerIdentity(address dev_, address agent, string memory name) internal {
        vm.prank(dev_);
        registry.registerAgentIdentity(
            agent, name, "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, 0
        );
    }

    function _commitLowRisk(address agent, bytes32 root, uint8 score) internal {
        vault.commitBatch(agent, root, "ipfs://x", 1, score, "READ", 0);
    }

    function _commitHighRisk(address agent, bytes32 root, uint8 score) internal {
        vault.commitBatch(agent, root, "ipfs://x", 1, score, "TRANSFER", 0);
    }

    function _commitMediumRisk(address agent, bytes32 root, uint8 score) internal {
        vault.commitBatch(agent, root, "ipfs://x", 1, score, "SWAP", 0);
    }

    function _commitWithProvenance(address agent, bytes32 root, uint8 score) internal {
        vault.commitBatchWithProvenance(
            agent, root, "ipfs://x", 1, score, "READ", 0,
            "claude-3-opus", INPUT_HASH, POLICY_HASH, AuditVault.TriggerEvent.USER_REQUEST
        );
    }

    // ─────────────────────────────────────────────
    // NEEDS_REVIEW — no data cases
    // ─────────────────────────────────────────────

    function test_GenerateReport_NoAgents_NeedsReview() public {
        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NEEDS_REVIEW));
        assertEq(r.agentsCount,   0);
        assertEq(r.highRiskCount, 0);
        assertEq(r.auditSummary.totalBatches, 0);
    }

    function test_GenerateReport_AgentsNoBatches_NeedsReview() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NEEDS_REVIEW));
        assertEq(r.agentsCount,   2);
        assertEq(r.highRiskCount, 0);
        assertEq(r.auditSummary.totalBatches, 0);
        assertEq(r.auditSummary.avgComplianceScore, 0);
    }

    // ─────────────────────────────────────────────
    // COMPLIANT
    // ─────────────────────────────────────────────

    function test_GenerateReport_Compliant() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");

        _commitLowRisk(agentA, ROOT1, 90);
        _commitLowRisk(agentB, ROOT2, 85);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.COMPLIANT));
        assertEq(r.highRiskCount, 0);
        // avg = (90 + 85) / 2 = 87
        assertEq(r.auditSummary.avgComplianceScore, 87);
    }

    function test_GenerateReport_Compliant_SingleAgent_HighScore() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 95);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.COMPLIANT));
    }

    function test_GenerateReport_Compliant_AvgScoreExactly80() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 80);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.COMPLIANT));
        assertEq(r.auditSummary.avgComplianceScore, 80);
    }

    // ─────────────────────────────────────────────
    // NEEDS_REVIEW
    // ─────────────────────────────────────────────

    function test_GenerateReport_NeedsReview_SomeHighRisk_NotMajority() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");

        _commitHighRisk(agentA, ROOT1, 80);  // agentA has HIGH risk
        _commitLowRisk(agentB, ROOT2, 85);   // agentB is fine

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        // 1 of 2 agents has HIGH risk → highRiskCount*2 = 2, agentsCount = 2 → NOT majority (> is strict)
        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NEEDS_REVIEW));
        assertEq(r.highRiskCount, 1);
    }

    function test_GenerateReport_NeedsReview_AvgScore50to79_NoHighRisk() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 70);  // score 70 → NEEDS_REVIEW (≥50 but <80, no high risk)

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NEEDS_REVIEW));
    }

    // ─────────────────────────────────────────────
    // NON_COMPLIANT
    // ─────────────────────────────────────────────

    function test_GenerateReport_NonCompliant_MajorityHighRisk() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");
        _registerIdentity(address(0xC0DE), agentC, "BotC");

        _commitHighRisk(agentA, ROOT1, 80);
        _commitHighRisk(agentB, ROOT2, 80);
        _commitLowRisk(agentC, ROOT3, 85);

        // 2 of 3 agents HIGH risk → 2*2=4 > 3 → NON_COMPLIANT
        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NON_COMPLIANT));
        assertEq(r.highRiskCount, 2);
    }

    function test_GenerateReport_NonCompliant_LowAvgScore() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 40);  // avgScore = 40 < 50 → NON_COMPLIANT

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NON_COMPLIANT));
        assertEq(r.auditSummary.avgComplianceScore, 40);
    }

    function test_GenerateReport_NonCompliant_AvgScoreExactly49() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 49);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(uint(r.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NON_COMPLIANT));
    }

    // ─────────────────────────────────────────────
    // Audit summary fields
    // ─────────────────────────────────────────────

    function test_AuditSummary_RiskBreakdown() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitHighRisk(agentA, ROOT1, 80);
        _commitMediumRisk(agentA, ROOT2, 80);
        _commitLowRisk(agentA, ROOT3, 80);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(r.auditSummary.totalBatches,      3);
        assertEq(r.auditSummary.highRiskBatches,   1);
        assertEq(r.auditSummary.mediumRiskBatches, 1);
        assertEq(r.auditSummary.lowRiskBatches,    1);
    }

    function test_AuditSummary_ProvenanceCount() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);         // no provenance
        _commitWithProvenance(agentA, ROOT2, 90);  // with provenance
        _commitWithProvenance(agentA, ROOT3, 90);  // with provenance

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(r.auditSummary.provenanceCount, 2);
        assertEq(r.auditSummary.totalBatches,    3);
    }

    function test_AuditSummary_AvgComplianceScore_MultipleAgents() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");

        // agentA: batches 60, 70, 80 → latest = 80
        _commitLowRisk(agentA, ROOT1, 60);
        _commitLowRisk(agentA, ROOT2, 70);
        _commitLowRisk(agentA, ROOT3, 80);
        // agentB: latest = 90
        _commitLowRisk(agentB, keccak256("r4"), 90);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        // avg of latest scores: (80 + 90) / 2 = 85
        assertEq(r.auditSummary.avgComplianceScore, 85);
        assertEq(r.auditSummary.totalBatches, 4);
    }

    function test_AuditSummary_AgentWithNoBatches_ExcludedFromAvg() public {
        _registerIdentity(dev, agentA, "BotA");
        _registerIdentity(dev2, agentB, "BotB");  // no batches

        _commitLowRisk(agentA, ROOT1, 90);

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        // only agentA contributes: avg = 90
        assertEq(r.auditSummary.avgComplianceScore, 90);
        assertEq(r.agentsCount, 2);
    }

    // ─────────────────────────────────────────────
    // highRiskCount — per-agent, not per-batch
    // ─────────────────────────────────────────────

    function test_HighRiskCount_AgentWithMultipleHighRiskBatches_CountsOnce() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitHighRisk(agentA, ROOT1, 80);
        _commitHighRisk(agentA, ROOT2, 80);  // same agent, two HIGH batches

        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        // agent has HIGH risk but counted once
        assertEq(r.highRiskCount, 1);
        assertEq(r.auditSummary.highRiskBatches, 2);
    }

    // ─────────────────────────────────────────────
    // Report metadata
    // ─────────────────────────────────────────────

    function test_Report_IdIncrementsCorrectly() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        uint256 id1 = reporter.generateComplianceReport();
        uint256 id2 = reporter.generateComplianceReport();
        uint256 id3 = reporter.generateComplianceReport();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(reporter.reportCount(), 3);
    }

    function test_Report_GeneratedAt_IsBlockTimestamp() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        vm.warp(1_700_000_000);
        uint256 id = reporter.generateComplianceReport();
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(id);

        assertEq(r.generatedAt, 1_700_000_000);
    }

    function test_Report_EmitsEvent() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        vm.expectEmit(true, false, false, true);
        emit ComplianceReportGenerated(
            1, 1, 0, EUAIActReporter.ComplianceStatus.COMPLIANT, block.timestamp
        );
        reporter.generateComplianceReport();
    }

    function test_Report_ReportIdStoredCorrectly() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        reporter.generateComplianceReport();
        reporter.generateComplianceReport();

        EUAIActReporter.ComplianceReport memory r = reporter.getReport(2);
        assertEq(r.reportId, 2);
    }

    // ─────────────────────────────────────────────
    // getLatestReport
    // ─────────────────────────────────────────────

    function test_GetLatestReport_ReturnsLastGenerated() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        reporter.generateComplianceReport();

        _commitLowRisk(agentA, ROOT2, 50);
        reporter.generateComplianceReport();  // second report — different avg

        EUAIActReporter.ComplianceReport memory r = reporter.getLatestReport();
        assertEq(r.reportId, 2);
    }

    function test_GetLatestReport_Reverts_NoReports() public {
        vm.expectRevert("EUAIActReporter: no reports yet");
        reporter.getLatestReport();
    }

    // ─────────────────────────────────────────────
    // getReport error cases
    // ─────────────────────────────────────────────

    function test_GetReport_Reverts_IdZero() public {
        vm.expectRevert("EUAIActReporter: report not found");
        reporter.getReport(0);
    }

    function test_GetReport_Reverts_IdTooHigh() public {
        vm.expectRevert("EUAIActReporter: report not found");
        reporter.getReport(1);
    }

    function test_GetReport_Reverts_IdExceedsCount() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);
        reporter.generateComplianceReport();

        vm.expectRevert("EUAIActReporter: report not found");
        reporter.getReport(2);
    }

    // ─────────────────────────────────────────────
    // Snapshot isolation — reports are independent
    // ─────────────────────────────────────────────

    function test_Reports_AreImmutableSnapshots() public {
        _registerIdentity(dev, agentA, "BotA");
        _commitLowRisk(agentA, ROOT1, 90);

        uint256 id1 = reporter.generateComplianceReport();

        // Add a HIGH-risk agent after report 1 is already captured
        _registerIdentity(dev2, agentB, "BotB");
        _commitHighRisk(agentB, ROOT2, 80);  // score 80, avg = (90+80)/2 = 85

        uint256 id2 = reporter.generateComplianceReport();

        EUAIActReporter.ComplianceReport memory r1 = reporter.getReport(id1);
        EUAIActReporter.ComplianceReport memory r2 = reporter.getReport(id2);

        // r1 was generated with 1 agent — stays immutable
        assertEq(r1.agentsCount,   1);
        assertEq(r1.highRiskCount, 0);
        assertEq(uint(r1.complianceStatus), uint(EUAIActReporter.ComplianceStatus.COMPLIANT));

        // r2 sees both agents: 1 HIGH-risk agent, avg=85≥80 but highRiskCount>0 → NEEDS_REVIEW
        assertEq(r2.agentsCount,   2);
        assertEq(r2.highRiskCount, 1);
        assertEq(uint(r2.complianceStatus), uint(EUAIActReporter.ComplianceStatus.NEEDS_REVIEW));

        // the two reports differ — proving r1 is an immutable snapshot
        assertLt(r1.agentsCount, r2.agentsCount);
    }
}
