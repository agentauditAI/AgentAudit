// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/QualityManagementSystem.sol";

contract QualityManagementSystemTest is Test {

    QualityManagementSystem public qms;

    address owner    = makeAddr("owner");
    address contrib  = makeAddr("contrib");
    address stranger = makeAddr("stranger");

    bytes32 constant AGENT_A = keccak256("agentA");
    bytes32 constant AGENT_B = keccak256("agentB");

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _register() internal returns (uint256 id) {
        vm.prank(owner);
        id = qms.registerQMS(
            AGENT_A,
            "AcmeCorp",
            "v1.0",
            "ipfs://qms-doc",
            365
        );
    }

    function _registerAndActivate() internal returns (uint256 id) {
        id = _register();
        vm.prank(owner);
        qms.activate(id);
    }

    function _fillAllPolicies(uint256 qmsId) internal {
        vm.startPrank(owner);
        for (uint256 i = 0; i < 9; i++) {
            qms.setPolicy(
                qmsId,
                QualityManagementSystem.PolicyArea(i),
                string(abi.encodePacked("ipfs://policy-", vm.toString(i))),
                "Policy description"
            );
        }
        vm.stopPrank();
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(owner);
        qms = new QualityManagementSystem();
    }

    // ─── Deployment ──────────────────────────────────────────────────────────

    function test_deployer_isOwner() public view {
        assertEq(qms.deployer(), owner);
    }

    function test_initialQmsCount_isZero() public view {
        assertEq(qms.qmsCount(), 0);
    }

    // ─── registerQMS ─────────────────────────────────────────────────────────

    function test_registerQMS_happy() public {
        vm.expectEmit(true, true, false, true, address(qms));
        emit QualityManagementSystem.QMSRegistered(
            1, AGENT_A, "AcmeCorp", "ipfs://qms-doc", owner, block.timestamp
        );
        uint256 id = _register();
        assertEq(id, 1);
        assertEq(qms.qmsCount(), 1);
    }

    function test_registerQMS_populatesRecord() public {
        uint256 id = _register();
        QualityManagementSystem.QMSRecord memory r = qms.getQMS(id);
        assertEq(r.id, 1);
        assertEq(r.agentId, AGENT_A);
        assertEq(r.providerName, "AcmeCorp");
        assertEq(r.systemVersion, "v1.0");
        assertEq(r.documentUri, "ipfs://qms-doc");
        assertEq(uint256(r.status), uint256(QualityManagementSystem.QMSStatus.DRAFT));
        assertEq(r.reviewIntervalDays, 365);
        assertEq(r.registeredBy, owner);
    }

    function test_registerQMS_revertsIfZeroAgentId() public {
        vm.prank(owner);
        vm.expectRevert(QualityManagementSystem.InvalidAgentId.selector);
        qms.registerQMS(bytes32(0), "AcmeCorp", "v1.0", "ipfs://doc", 365);
    }

    function test_registerQMS_revertsIfEmptyProviderName() public {
        vm.prank(owner);
        vm.expectRevert(QualityManagementSystem.EmptyField.selector);
        qms.registerQMS(AGENT_A, "", "v1.0", "ipfs://doc", 365);
    }

    function test_registerQMS_revertsIfEmptyDocumentUri() public {
        vm.prank(owner);
        vm.expectRevert(QualityManagementSystem.EmptyField.selector);
        qms.registerQMS(AGENT_A, "AcmeCorp", "v1.0", "", 365);
    }

    function test_registerQMS_revertsIfZeroInterval() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.InvalidReviewInterval.selector, 0)
        );
        qms.registerQMS(AGENT_A, "AcmeCorp", "v1.0", "ipfs://doc", 0);
    }

    function test_registerQMS_mapsAgentToId() public {
        uint256 id = _register();
        assertEq(qms.getAgentQMSId(AGENT_A), id);
    }

    function test_getAgentQMSId_revertsIfNoQMS() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.AgentHasNoQMS.selector, AGENT_B)
        );
        qms.getAgentQMSId(AGENT_B);
    }

    function test_registerQMS_multipleAgents() public {
        vm.prank(owner);
        uint256 id1 = qms.registerQMS(AGENT_A, "Corp1", "v1", "ipfs://a", 30);
        vm.prank(owner);
        uint256 id2 = qms.registerQMS(AGENT_B, "Corp2", "v2", "ipfs://b", 30);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(qms.getAgentQMSId(AGENT_A), 1);
        assertEq(qms.getAgentQMSId(AGENT_B), 2);
    }

    function test_registerQMS_sameAgentOverwritesMapping() public {
        _register(); // id=1
        vm.prank(owner);
        uint256 id2 = qms.registerQMS(AGENT_A, "AcmeCorp", "v2.0", "ipfs://v2", 365);
        assertEq(qms.getAgentQMSId(AGENT_A), id2);
    }

    // ─── activate ────────────────────────────────────────────────────────────

    function test_activate_draftToActive() public {
        uint256 id = _register();
        vm.expectEmit(true, false, false, true, address(qms));
        emit QualityManagementSystem.QMSStatusChanged(
            id,
            QualityManagementSystem.QMSStatus.DRAFT,
            QualityManagementSystem.QMSStatus.ACTIVE,
            owner,
            block.timestamp
        );
        vm.prank(owner);
        qms.activate(id);
        assertEq(uint256(qms.getQMS(id).status), uint256(QualityManagementSystem.QMSStatus.ACTIVE));
    }

    function test_activate_revertsIfAlreadyActive() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                QualityManagementSystem.InvalidStatus.selector,
                QualityManagementSystem.QMSStatus.ACTIVE
            )
        );
        qms.activate(id);
    }

    function test_activate_revertsIfSuperseded() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.supersede(id);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.AlreadySuperseded.selector, id)
        );
        qms.activate(id);
    }

    function test_activate_revertsIfNotAuthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.activate(id);
    }

    function test_activate_revertsIfQMSNotFound() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 99)
        );
        qms.activate(99);
    }

    // ─── markUnderReview / completeReview ─────────────────────────────────────

    function test_markUnderReview_happy() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.markUnderReview(id);
        assertEq(
            uint256(qms.getQMS(id).status),
            uint256(QualityManagementSystem.QMSStatus.UNDER_REVIEW)
        );
    }

    function test_markUnderReview_revertsIfNotActive() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                QualityManagementSystem.InvalidStatus.selector,
                QualityManagementSystem.QMSStatus.DRAFT
            )
        );
        qms.markUnderReview(id);
    }

    function test_markUnderReview_revertsIfNotAuthorized() public {
        uint256 id = _registerAndActivate();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.markUnderReview(id);
    }

    function test_completeReview_happy() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.markUnderReview(id);

        uint256 before = qms.getQMS(id).lastReviewAt;
        vm.warp(block.timestamp + 1 days);

        vm.prank(owner);
        qms.completeReview(id);

        QualityManagementSystem.QMSRecord memory r = qms.getQMS(id);
        assertEq(uint256(r.status), uint256(QualityManagementSystem.QMSStatus.ACTIVE));
        assertGt(r.lastReviewAt, before);
    }

    function test_completeReview_revertsIfNotUnderReview() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                QualityManagementSystem.InvalidStatus.selector,
                QualityManagementSystem.QMSStatus.ACTIVE
            )
        );
        qms.completeReview(id);
    }

    function test_completeReview_revertsIfNotAuthorized() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.markUnderReview(id);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.completeReview(id);
    }

    // ─── supersede ───────────────────────────────────────────────────────────

    function test_supersede_happy() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.supersede(id);
        assertEq(
            uint256(qms.getQMS(id).status),
            uint256(QualityManagementSystem.QMSStatus.SUPERSEDED)
        );
    }

    function test_supersede_fromDraft() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.supersede(id);
        assertEq(
            uint256(qms.getQMS(id).status),
            uint256(QualityManagementSystem.QMSStatus.SUPERSEDED)
        );
    }

    function test_supersede_revertsIfAlreadySuperseded() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.supersede(id);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.AlreadySuperseded.selector, id)
        );
        qms.supersede(id);
    }

    function test_supersede_revertsIfNotAuthorized() public {
        uint256 id = _registerAndActivate();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.supersede(id);
    }

    // ─── setPolicy ───────────────────────────────────────────────────────────

    function test_setPolicy_happy() public {
        uint256 id = _register();
        vm.expectEmit(true, false, false, true, address(qms));
        emit QualityManagementSystem.PolicyUpdated(
            id,
            QualityManagementSystem.PolicyArea.COMPLIANCE_STRATEGY,
            QualityManagementSystem.PolicyStatus.ACTIVE,
            "ipfs://policy-a",
            owner,
            block.timestamp
        );
        vm.prank(owner);
        qms.setPolicy(
            id,
            QualityManagementSystem.PolicyArea.COMPLIANCE_STRATEGY,
            "ipfs://policy-a",
            "Compliance strategy policy"
        );

        QualityManagementSystem.PolicyRecord memory p =
            qms.getPolicy(id, QualityManagementSystem.PolicyArea.COMPLIANCE_STRATEGY);
        assertEq(p.policyUri, "ipfs://policy-a");
        assertEq(p.description, "Compliance strategy policy");
        assertEq(uint256(p.status), uint256(QualityManagementSystem.PolicyStatus.ACTIVE));
    }

    function test_setPolicy_allNineAreas() public {
        uint256 id = _register();
        _fillAllPolicies(id);
        assertEq(qms.activePolicyCount(id), 9);
    }

    function test_setPolicy_revertsIfSuperseded() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.supersede(id);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.AlreadySuperseded.selector, id)
        );
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.DOCUMENTATION, "ipfs://x", "desc");
    }

    function test_setPolicy_revertsIfEmptyUri() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(QualityManagementSystem.EmptyField.selector);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.DOCUMENTATION, "", "desc");
    }

    function test_setPolicy_revertsIfNotAuthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.ACCOUNTABILITY, "ipfs://x", "d");
    }

    function test_setPolicy_allowedByContributor() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.setContributor(id, contrib, true);
        vm.prank(contrib);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.DATA_MANAGEMENT, "ipfs://dm", "dm");
        assertEq(
            qms.getPolicy(id, QualityManagementSystem.PolicyArea.DATA_MANAGEMENT).policyUri,
            "ipfs://dm"
        );
    }

    function test_setPolicy_canUpdate() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.LOGGING_AND_MONITORING, "ipfs://v1", "v1");
        vm.prank(owner);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.LOGGING_AND_MONITORING, "ipfs://v2", "v2");
        assertEq(
            qms.getPolicy(id, QualityManagementSystem.PolicyArea.LOGGING_AND_MONITORING).policyUri,
            "ipfs://v2"
        );
    }

    // ─── recordAudit ─────────────────────────────────────────────────────────

    function test_recordAudit_happy() public {
        uint256 id = _registerAndActivate();
        vm.expectEmit(true, false, false, true, address(qms));
        emit QualityManagementSystem.AuditRecorded(id, true, owner, block.timestamp);
        vm.prank(owner);
        qms.recordAudit(id, "All areas covered", "ipfs://audit-1", true);

        QualityManagementSystem.AuditRecord[] memory audits = qms.getAudits(id);
        assertEq(audits.length, 1);
        assertEq(audits[0].findings, "All areas covered");
        assertEq(audits[0].auditUri, "ipfs://audit-1");
        assertTrue(audits[0].passed);
        assertEq(audits[0].auditor, owner);
    }

    function test_recordAudit_multipleAudits() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.recordAudit(id, "Audit 1", "ipfs://a1", true);
        vm.prank(owner);
        qms.recordAudit(id, "Audit 2", "ipfs://a2", false);
        assertEq(qms.getAudits(id).length, 2);
    }

    function test_recordAudit_revertsIfEmptyFindings() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        vm.expectRevert(QualityManagementSystem.EmptyField.selector);
        qms.recordAudit(id, "", "ipfs://audit", true);
    }

    function test_recordAudit_revertsIfNotAuthorized() public {
        uint256 id = _registerAndActivate();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.recordAudit(id, "findings", "ipfs://audit", true);
    }

    function test_recordAudit_allowedByContributor() public {
        uint256 id = _registerAndActivate();
        vm.prank(owner);
        qms.setContributor(id, contrib, true);
        vm.prank(contrib);
        qms.recordAudit(id, "Contrib audit", "", false);
        assertEq(qms.getAudits(id)[0].auditor, contrib);
    }

    // ─── setContributor ───────────────────────────────────────────────────────

    function test_setContributor_authorize() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(qms));
        emit QualityManagementSystem.ContributorSet(id, contrib, true, block.timestamp);
        qms.setContributor(id, contrib, true);
        assertTrue(qms.contributors(id, contrib));
    }

    function test_setContributor_revoke() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.setContributor(id, contrib, true);
        vm.prank(owner);
        qms.setContributor(id, contrib, false);
        assertFalse(qms.contributors(id, contrib));
    }

    function test_setContributor_revertsIfNotAuthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.NotAuthorized.selector, stranger)
        );
        qms.setContributor(id, contrib, true);
    }

    function test_deployerCanSetContributor() public {
        uint256 id = _register();
        vm.prank(owner); // owner is deployer in this setup
        qms.setContributor(id, contrib, true);
        assertTrue(qms.contributors(id, contrib));
    }

    // ─── isComplete ──────────────────────────────────────────────────────────

    function test_isComplete_falseWhenNoPolicies() public {
        uint256 id = _register();
        assertFalse(qms.isComplete(id));
    }

    function test_isComplete_falseWhenPartial() public {
        uint256 id = _register();
        vm.prank(owner);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.COMPLIANCE_STRATEGY, "ipfs://p1", "d");
        assertFalse(qms.isComplete(id));
    }

    function test_isComplete_trueWhenAllNine() public {
        uint256 id = _register();
        _fillAllPolicies(id);
        assertTrue(qms.isComplete(id));
    }

    function test_isComplete_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 99)
        );
        qms.isComplete(99);
    }

    // ─── isCurrent ───────────────────────────────────────────────────────────

    function test_isCurrent_falseIfNotActive() public {
        uint256 id = _register();
        assertFalse(qms.isCurrent(id));
    }

    function test_isCurrent_trueWhenActiveAndWithinInterval() public {
        uint256 id = _registerAndActivate();
        assertTrue(qms.isCurrent(id));
    }

    function test_isCurrent_falseWhenOverdueForReview() public {
        uint256 id = _registerAndActivate();
        vm.warp(block.timestamp + 366 days);
        assertFalse(qms.isCurrent(id));
    }

    function test_isCurrent_trueAfterCompleteReview() public {
        uint256 id = _registerAndActivate();
        vm.warp(block.timestamp + 200 days);
        vm.prank(owner);
        qms.markUnderReview(id);
        vm.prank(owner);
        qms.completeReview(id);
        // now lastReviewAt is reset; 365-day interval starts fresh
        assertTrue(qms.isCurrent(id));
    }

    function test_isCurrent_returnsFalseIfNotFound() public {
        assertFalse(qms.isCurrent(99));
    }

    // ─── activePolicyCount ───────────────────────────────────────────────────

    function test_activePolicyCount_zeroInitially() public {
        uint256 id = _register();
        assertEq(qms.activePolicyCount(id), 0);
    }

    function test_activePolicyCount_incrementsWithEachPolicy() public {
        uint256 id = _register();
        for (uint256 i = 0; i < 9; i++) {
            vm.prank(owner);
            qms.setPolicy(
                id,
                QualityManagementSystem.PolicyArea(i),
                "ipfs://p",
                "desc"
            );
            assertEq(qms.activePolicyCount(id), i + 1);
        }
    }

    function test_activePolicyCount_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 0)
        );
        qms.activePolicyCount(0);
    }

    // ─── getQMS ──────────────────────────────────────────────────────────────

    function test_getQMS_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 1)
        );
        qms.getQMS(1);
    }

    // ─── getPolicy ───────────────────────────────────────────────────────────

    function test_getPolicy_revertsIfQMSNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 99)
        );
        qms.getPolicy(99, QualityManagementSystem.PolicyArea.COMPLIANCE_STRATEGY);
    }

    function test_getPolicy_returnsDefaultIfNotSet() public {
        uint256 id = _register();
        QualityManagementSystem.PolicyRecord memory p =
            qms.getPolicy(id, QualityManagementSystem.PolicyArea.ACCOUNTABILITY);
        assertEq(uint256(p.status), uint256(QualityManagementSystem.PolicyStatus.MISSING));
    }

    // ─── getAudits ───────────────────────────────────────────────────────────

    function test_getAudits_revertsIfQMSNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(QualityManagementSystem.QMSNotFound.selector, 5)
        );
        qms.getAudits(5);
    }

    function test_getAudits_emptyInitially() public {
        uint256 id = _register();
        assertEq(qms.getAudits(id).length, 0);
    }

    // ─── Deployer override ───────────────────────────────────────────────────

    function test_deployerCanActivateAnyQMS() public {
        vm.prank(stranger);
        uint256 id = qms.registerQMS(AGENT_B, "Stranger Corp", "v1", "ipfs://x", 30);
        vm.prank(owner); // owner is deployer
        qms.activate(id);
        assertEq(
            uint256(qms.getQMS(id).status),
            uint256(QualityManagementSystem.QMSStatus.ACTIVE)
        );
    }

    function test_deployerCanSetPolicyOnAnyQMS() public {
        vm.prank(stranger);
        uint256 id = qms.registerQMS(AGENT_B, "Stranger Corp", "v1", "ipfs://x", 30);
        vm.prank(owner);
        qms.setPolicy(id, QualityManagementSystem.PolicyArea.DOCUMENTATION, "ipfs://d", "desc");
        assertEq(
            qms.getPolicy(id, QualityManagementSystem.PolicyArea.DOCUMENTATION).policyUri,
            "ipfs://d"
        );
    }
}
