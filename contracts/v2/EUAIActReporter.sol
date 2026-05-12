// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EUAIActReporter
/// @notice Auto-generated EU AI Act compliance reports
contract EUAIActReporter {

    struct ArticleChecks {
        bool art9_riskManagement;
        bool art11_technicalDocs;
        bool art12_recordKeeping;
        bool art13_transparency;
        bool art14_humanOversight;
        bool art19_logging;
        bool art26_deployerObligations;
        bool art50_transparency;
    }

    struct ComplianceReport {
        uint256 id;
        bytes32 agentId;
        uint256 generatedAt;
        ArticleChecks checks;
        uint8   complianceScore;
        string  reportHash;
        address generatedBy;
    }

    mapping(uint256 => ComplianceReport) public reports;
    mapping(bytes32 => uint256[]) public agentReports;
    uint256 public reportCount;

    event ReportGenerated(uint256 indexed id, bytes32 indexed agentId, uint8 score, uint256 timestamp);

    function generateReport(
        bytes32 agentId,
        ArticleChecks calldata checks,
        string calldata reportHash
    ) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");

        uint8 score = _calcScore(checks);
        uint256 id = ++reportCount;

        reports[id].id = id;
        reports[id].agentId = agentId;
        reports[id].generatedAt = block.timestamp;
        reports[id].checks = checks;
        reports[id].complianceScore = score;
        reports[id].reportHash = reportHash;
        reports[id].generatedBy = msg.sender;

        agentReports[agentId].push(id);
        emit ReportGenerated(id, agentId, score, block.timestamp);
        return id;
    }

    function getReport(uint256 id) external view returns (ComplianceReport memory) {
        return reports[id];
    }

    function getLatestReport(bytes32 agentId) external view returns (ComplianceReport memory) {
        uint256[] memory ids = agentReports[agentId];
        require(ids.length > 0, "No reports found");
        return reports[ids[ids.length - 1]];
    }

    function getAgentReports(bytes32 agentId) external view returns (uint256[] memory) {
        return agentReports[agentId];
    }

    function isCompliant(bytes32 agentId, uint8 threshold) external view returns (bool) {
        uint256[] memory ids = agentReports[agentId];
        require(ids.length > 0, "No reports found");
        return reports[ids[ids.length - 1]].complianceScore >= threshold;
    }

    function _calcScore(ArticleChecks calldata c) internal pure returns (uint8) {
        uint8 count = 0;
        if (c.art9_riskManagement)      count++;
        if (c.art11_technicalDocs)      count++;
        if (c.art12_recordKeeping)      count++;
        if (c.art13_transparency)       count++;
        if (c.art14_humanOversight)     count++;
        if (c.art19_logging)            count++;
        if (c.art26_deployerObligations) count++;
        if (c.art50_transparency)       count++;
        return uint8((uint256(count) * 100) / 8);
    }
}
