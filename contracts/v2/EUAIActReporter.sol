// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AgentIdentityRegistry.sol";
import "./AuditVault.sol";

/// @title EUAIActReporter
/// @notice Automatically generates on-chain EU AI Act compliance reports by aggregating
///         data from AgentIdentityRegistry (who the agents are) and AuditVault (what they did).
/// @dev    Compliance status rules:
///           COMPLIANT    — zero HIGH-risk agents AND average compliance score ≥ 80
///           NON_COMPLIANT — majority of agents have ≥1 HIGH-risk batch OR avg score < 50
///           NEEDS_REVIEW  — everything else, including no data yet
contract EUAIActReporter {

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    enum ComplianceStatus { COMPLIANT, NEEDS_REVIEW, NON_COMPLIANT }

    /// @notice Aggregate batch-level metrics across all agents in the report
    struct AuditSummary {
        uint256 totalBatches;
        uint256 highRiskBatches;
        uint256 mediumRiskBatches;
        uint256 lowRiskBatches;
        uint256 avgComplianceScore;  // 0-100, average of each agent's latest score
        uint256 provenanceCount;     // batches with Decision Provenance recorded
    }

    /// @notice Full on-chain compliance report — maps 1:1 to the JSON spec
    struct ComplianceReport {
        uint256          reportId;
        uint256          generatedAt;      // block.timestamp
        uint256          agentsCount;      // total identities in registry
        uint256          highRiskCount;    // agents with ≥1 HIGH-risk batch
        ComplianceStatus complianceStatus;
        AuditSummary     auditSummary;
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    AgentIdentityRegistry public immutable identityRegistry;
    AuditVault            public immutable auditVault;

    mapping(uint256 => ComplianceReport) private _reports;
    uint256 public reportCount;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event ComplianceReportGenerated(
        uint256          indexed reportId,
        uint256                  agentsCount,
        uint256                  highRiskCount,
        ComplianceStatus         complianceStatus,
        uint256                  timestamp
    );

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    constructor(address identityRegistryAddr, address auditVaultAddr) {
        require(identityRegistryAddr != address(0), "EUAIActReporter: zero identityRegistry");
        require(auditVaultAddr       != address(0), "EUAIActReporter: zero auditVault");
        identityRegistry = AgentIdentityRegistry(identityRegistryAddr);
        auditVault       = AuditVault(auditVaultAddr);
    }

    // ─────────────────────────────────────────────
    // Report Generation
    // ─────────────────────────────────────────────

    /// @notice Generate a compliance report by reading all on-chain data automatically.
    ///         No parameters required — the report is fully derived from chain state.
    /// @return reportId Sequential ID of the stored report (starts at 1)
    function generateComplianceReport() external returns (uint256 reportId) {
        address[] memory agents = identityRegistry.getRegisteredAgents();
        uint256 agentsCount = agents.length;

        AuditSummary memory summary;
        uint256 highRiskCount;
        uint256 complianceScoreSum;
        uint256 agentsWithBatches;

        for (uint256 i = 0; i < agentsCount; i++) {
            address agent = agents[i];
            uint256 batchCount = auditVault.getBatchCount(agent);
            bool agentHasHighRisk = false;

            for (uint256 j = 0; j < batchCount; j++) {
                AuditVault.RiskScore memory risk = auditVault.getRiskScore(agent, j);

                summary.totalBatches++;

                if (risk.level == AuditVault.RiskLevel.HIGH) {
                    summary.highRiskBatches++;
                    agentHasHighRisk = true;
                } else if (risk.level == AuditVault.RiskLevel.MEDIUM) {
                    summary.mediumRiskBatches++;
                } else {
                    summary.lowRiskBatches++;
                }

                if (auditVault.hasProvenance(agent, j)) {
                    summary.provenanceCount++;
                }
            }

            if (agentHasHighRisk) highRiskCount++;

            if (batchCount > 0) {
                complianceScoreSum += auditVault.getLatestComplianceScore(agent);
                agentsWithBatches++;
            }
        }

        summary.avgComplianceScore = agentsWithBatches > 0
            ? complianceScoreSum / agentsWithBatches
            : 0;

        ComplianceStatus status = _computeStatus(
            highRiskCount, agentsCount, summary.avgComplianceScore, summary.totalBatches
        );

        reportId = ++reportCount;
        _reports[reportId] = ComplianceReport({
            reportId:         reportId,
            generatedAt:      block.timestamp,
            agentsCount:      agentsCount,
            highRiskCount:    highRiskCount,
            complianceStatus: status,
            auditSummary:     summary
        });

        emit ComplianceReportGenerated(reportId, agentsCount, highRiskCount, status, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Read Functions
    // ─────────────────────────────────────────────

    /// @notice Retrieve a stored report by ID.
    function getReport(uint256 reportId) external view returns (ComplianceReport memory) {
        require(reportId > 0 && reportId <= reportCount, "EUAIActReporter: report not found");
        return _reports[reportId];
    }

    /// @notice Retrieve the most recently generated report.
    function getLatestReport() external view returns (ComplianceReport memory) {
        require(reportCount > 0, "EUAIActReporter: no reports yet");
        return _reports[reportCount];
    }

    // ─────────────────────────────────────────────
    // Internal — compliance status logic
    // ─────────────────────────────────────────────

    /// @dev Rules (applied in order):
    ///   1. No agents or no batches yet              → NEEDS_REVIEW  (not enough data to assess)
    ///   2. avgScore < 50 OR majority are HIGH-risk  → NON_COMPLIANT
    ///   3. zero HIGH-risk agents AND avgScore ≥ 80  → COMPLIANT
    ///   4. otherwise                                → NEEDS_REVIEW
    function _computeStatus(
        uint256 highRiskCount,
        uint256 agentsCount,
        uint256 avgScore,
        uint256 totalBatches
    ) internal pure returns (ComplianceStatus) {
        if (agentsCount == 0 || totalBatches == 0) return ComplianceStatus.NEEDS_REVIEW;
        if (avgScore < 50 || highRiskCount * 2 > agentsCount) return ComplianceStatus.NON_COMPLIANT;
        if (highRiskCount == 0 && avgScore >= 80)              return ComplianceStatus.COMPLIANT;
        return ComplianceStatus.NEEDS_REVIEW;
    }
}
