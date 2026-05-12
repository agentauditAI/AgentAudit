// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/EUAIActReporter.sol";

contract EUAIActReporterTest is Test {
    EUAIActReporter public reporter;
    bytes32 constant AGENT_ID = keccak256("agent-001");
    string constant HASH = "ipfs://QmReport123";

    EUAIActReporter.ArticleChecks allTrue;
    EUAIActReporter.ArticleChecks allFalse;
    EUAIActReporter.ArticleChecks halfTrue;

    function setUp() public {
        reporter = new EUAIActReporter();
        allTrue = EUAIActReporter.ArticleChecks(true,true,true,true,true,true,true,true);
        allFalse = EUAIActReporter.ArticleChecks(false,false,false,false,false,false,false,false);
        halfTrue = EUAIActReporter.ArticleChecks(true,true,true,true,false,false,false,false);
    }

    function test_GenerateReport_FullCompliance() public {
        uint256 id = reporter.generateReport(AGENT_ID, allTrue, HASH);
        assertEq(id, 1);
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(1);
        assertEq(r.complianceScore, 100);
    }

    function test_GenerateReport_ZeroCompliance() public {
        reporter.generateReport(AGENT_ID, allFalse, HASH);
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(1);
        assertEq(r.complianceScore, 0);
    }

    function test_GenerateReport_HalfCompliance() public {
        reporter.generateReport(AGENT_ID, halfTrue, HASH);
        EUAIActReporter.ComplianceReport memory r = reporter.getReport(1);
        assertEq(r.complianceScore, 50);
    }

    function test_GenerateReport_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit EUAIActReporter.ReportGenerated(1, AGENT_ID, 100, block.timestamp);
        reporter.generateReport(AGENT_ID, allTrue, HASH);
    }

    function test_RevertIf_InvalidAgentId() public {
        vm.expectRevert("Invalid agentId");
        reporter.generateReport(bytes32(0), allTrue, HASH);
    }

    function test_GetLatestReport() public {
        reporter.generateReport(AGENT_ID, allFalse, HASH);
        reporter.generateReport(AGENT_ID, allTrue, HASH);
        EUAIActReporter.ComplianceReport memory r = reporter.getLatestReport(AGENT_ID);
        assertEq(r.complianceScore, 100);
    }

    function test_RevertIf_NoReports() public {
        vm.expectRevert("No reports found");
        reporter.getLatestReport(AGENT_ID);
    }

    function test_IsCompliant_Above() public {
        reporter.generateReport(AGENT_ID, allTrue, HASH);
        assertTrue(reporter.isCompliant(AGENT_ID, 80));
    }

    function test_IsCompliant_Below() public {
        reporter.generateReport(AGENT_ID, halfTrue, HASH);
        assertFalse(reporter.isCompliant(AGENT_ID, 80));
    }

    function test_MultipleReports() public {
        reporter.generateReport(AGENT_ID, allFalse, HASH);
        reporter.generateReport(AGENT_ID, halfTrue, HASH);
        reporter.generateReport(AGENT_ID, allTrue, HASH);
        uint256[] memory ids = reporter.getAgentReports(AGENT_ID);
        assertEq(ids.length, 3);
    }

    function test_ReportCount() public {
        assertEq(reporter.reportCount(), 0);
        reporter.generateReport(AGENT_ID, allTrue, HASH);
        assertEq(reporter.reportCount(), 1);
    }
}
