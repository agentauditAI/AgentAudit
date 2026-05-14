// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/DataGovernanceRegistry.sol";

contract DataGovernanceRegistryTest is Test {

    DataGovernanceRegistry public reg;

    address deployer  = makeAddr("deployer");
    address owner     = makeAddr("owner");
    address assessor  = makeAddr("assessor");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_ID   = keccak256("agent-001");
    bytes32 constant AGENT_ID2  = keccak256("agent-002");
    bytes32 constant CONTENT_HASH = keccak256("dataset-v1-content");

    string constant DS_NAME     = "EU Hiring Decisions 2024";
    string constant DS_VERSION  = "2024-Q4-v1";
    string constant SOURCE_URI  = "ipfs://QmSource123";
    string constant ASSESS_URI  = "ipfs://QmQualityReport";
    string constant MITIGATION  = "ipfs://QmBiasMitigation";

    DataGovernanceRegistry.DatasetRole constant ROLE = DataGovernanceRegistry.DatasetRole.TRAINING;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        reg = new DataGovernanceRegistry();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _params(bytes32 agentId) internal pure returns (DataGovernanceRegistry.DatasetParams memory) {
        return DataGovernanceRegistry.DatasetParams({
            agentId:        agentId,
            role:           DataGovernanceRegistry.DatasetRole.TRAINING,
            name:           DS_NAME,
            version:        DS_VERSION,
            sourceUri:      SOURCE_URI,
            contentHash:    CONTENT_HASH,
            description:    "Collected from EU public employment service 2020-2024",
            dataPointCount: 150000
        });
    }

    function _register() internal returns (uint256) {
        vm.prank(owner);
        return reg.registerDataset(_params(AGENT_ID));
    }

    function _register(bytes32 agentId) internal returns (uint256) {
        vm.prank(owner);
        return reg.registerDataset(_params(agentId));
    }

    function _quality(uint256 id, DataGovernanceRegistry.QualityStatus status) internal {
        vm.prank(owner);
        reg.recordQualityAssessment(id, status, 9800, 9500, 200, ASSESS_URI);
    }

    function _bias(uint256 id, DataGovernanceRegistry.BiasStatus status) internal {
        vm.prank(owner);
        reg.recordBiasExamination(id, status, "none", "gender,age,ethnicity", MITIGATION);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), deployer);
    }

    function test_datasetCount_startsAtZero() public view {
        assertEq(reg.datasetCount(), 0);
    }

    // ─── registerDataset ─────────────────────────────────────────────────────

    function test_register_success() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit DataGovernanceRegistry.DatasetRegistered(
            1, AGENT_ID, ROLE, DS_NAME, CONTENT_HASH, owner, block.timestamp
        );
        uint256 id = reg.registerDataset(_params(AGENT_ID));

        assertEq(id, 1);
        assertEq(reg.datasetCount(), 1);

        DataGovernanceRegistry.DatasetRecord memory d = reg.getDataset(id);
        assertEq(d.id, 1);
        assertEq(d.agentId, AGENT_ID);
        assertEq(uint(d.role), uint(ROLE));
        assertEq(d.name, DS_NAME);
        assertEq(d.version, DS_VERSION);
        assertEq(d.sourceUri, SOURCE_URI);
        assertEq(d.contentHash, CONTENT_HASH);
        assertEq(d.dataPointCount, 150000);
        assertEq(d.registeredBy, owner);
        assertEq(d.registeredAt, block.timestamp);
        assertTrue(d.active);
    }

    function test_register_seedsQualityAndBiasPending() public {
        uint256 id = _register();
        DataGovernanceRegistry.QualityAssessment memory q = reg.getQualityAssessment(id);
        DataGovernanceRegistry.BiasExamination   memory b = reg.getBiasExamination(id);
        assertEq(uint(q.status), uint(DataGovernanceRegistry.QualityStatus.PENDING));
        assertEq(uint(b.status), uint(DataGovernanceRegistry.BiasStatus.NOT_CHECKED));
    }

    function test_register_appendsToAgentDatasets() public {
        _register();
        _register();
        uint256[] memory ids = reg.getAgentDatasets(AGENT_ID);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_register_multipleAgents() public {
        _register(AGENT_ID);
        _register(AGENT_ID2);
        assertEq(reg.getAgentDatasets(AGENT_ID).length, 1);
        assertEq(reg.getAgentDatasets(AGENT_ID2).length, 1);
    }

    function test_register_allRoles() public {
        DataGovernanceRegistry.DatasetRole[3] memory roles = [
            DataGovernanceRegistry.DatasetRole.TRAINING,
            DataGovernanceRegistry.DatasetRole.VALIDATION,
            DataGovernanceRegistry.DatasetRole.TESTING
        ];
        bytes32[3] memory agents = [keccak256("a0"), keccak256("a1"), keccak256("a2")];
        for (uint i = 0; i < 3; i++) {
            DataGovernanceRegistry.DatasetParams memory p = _params(agents[i]);
            p.role = roles[i];
            vm.prank(owner);
            uint256 id = reg.registerDataset(p);
            assertEq(uint(reg.getDataset(id).role), uint(roles[i]));
        }
    }

    function test_register_revertsIfZeroAgentId() public {
        vm.prank(owner);
        vm.expectRevert(DataGovernanceRegistry.InvalidAgentId.selector);
        reg.registerDataset(_params(bytes32(0)));
    }

    function test_register_revertsIfEmptyName() public {
        DataGovernanceRegistry.DatasetParams memory p = _params(AGENT_ID);
        p.name = "";
        vm.prank(owner);
        vm.expectRevert(DataGovernanceRegistry.EmptyField.selector);
        reg.registerDataset(p);
    }

    function test_register_revertsIfZeroContentHash() public {
        DataGovernanceRegistry.DatasetParams memory p = _params(AGENT_ID);
        p.contentHash = bytes32(0);
        vm.prank(owner);
        vm.expectRevert(DataGovernanceRegistry.EmptyField.selector);
        reg.registerDataset(p);
    }

    // ─── setAssessor ─────────────────────────────────────────────────────────

    function test_setAssessor_authorizes() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit DataGovernanceRegistry.AssessorSet(id, assessor, true, block.timestamp);
        reg.setAssessor(id, assessor, true);
        assertTrue(reg.assessors(id, assessor));
    }

    function test_setAssessor_revokes() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.setAssessor(id, assessor, true);
        vm.prank(owner);
        reg.setAssessor(id, assessor, false);
        assertFalse(reg.assessors(id, assessor));
    }

    function test_setAssessor_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.NotAuthorized.selector, stranger));
        reg.setAssessor(id, assessor, true);
    }

    function test_setAssessor_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.setAssessor(99, assessor, true);
    }

    // ─── recordQualityAssessment ─────────────────────────────────────────────

    function test_quality_passed() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit DataGovernanceRegistry.QualityAssessed(
            id, DataGovernanceRegistry.QualityStatus.PASSED,
            9800, 9500, 200, owner, block.timestamp
        );
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9800, 9500, 200, ASSESS_URI);

        DataGovernanceRegistry.QualityAssessment memory q = reg.getQualityAssessment(id);
        assertEq(uint(q.status), uint(DataGovernanceRegistry.QualityStatus.PASSED));
        assertEq(q.completenessScore, 9800);
        assertEq(q.representativenessScore, 9500);
        assertEq(q.errorRate, 200);
        assertEq(q.assessmentUri, ASSESS_URI);
        assertEq(q.assessedBy, owner);
        assertEq(q.assessedAt, block.timestamp);
    }

    function test_quality_assessorCanRecord() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.setAssessor(id, assessor, true);
        vm.prank(assessor);
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 8000, 100, ASSESS_URI);
        assertEq(reg.getQualityAssessment(id).assessedBy, assessor);
    }

    function test_quality_deployerCanRecord() public {
        uint256 id = _register();
        vm.prank(deployer);
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.FAILED, 5000, 4000, 3000, ASSESS_URI);
        assertEq(uint(reg.getQualityAssessment(id).status), uint(DataGovernanceRegistry.QualityStatus.FAILED));
    }

    function test_quality_canBeUpdated() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.FAILED);
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        assertEq(uint(reg.getQualityAssessment(id).status), uint(DataGovernanceRegistry.QualityStatus.PASSED));
    }

    function test_quality_allStatuses() public {
        DataGovernanceRegistry.QualityStatus[4] memory statuses = [
            DataGovernanceRegistry.QualityStatus.PENDING,
            DataGovernanceRegistry.QualityStatus.PASSED,
            DataGovernanceRegistry.QualityStatus.FAILED,
            DataGovernanceRegistry.QualityStatus.CONDITIONAL
        ];
        uint256 id = _register();
        for (uint i = 0; i < statuses.length; i++) {
            vm.prank(owner);
            reg.recordQualityAssessment(id, statuses[i], 5000, 5000, 500, ASSESS_URI);
            assertEq(uint(reg.getQualityAssessment(id).status), uint(statuses[i]));
        }
    }

    function test_quality_revertsIfInvalidScore_completeness() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.InvalidScore.selector, uint16(10001)));
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 10001, 9000, 100, ASSESS_URI);
    }

    function test_quality_revertsIfInvalidScore_representativeness() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.InvalidScore.selector, uint16(10001)));
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 10001, 100, ASSESS_URI);
    }

    function test_quality_revertsIfInvalidScore_errorRate() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.InvalidScore.selector, uint16(10001)));
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 9000, 10001, ASSESS_URI);
    }

    function test_quality_revertsIfInactive() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.deactivateDataset(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetInactive.selector, id));
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 9000, 100, ASSESS_URI);
    }

    function test_quality_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.NotAuthorized.selector, stranger));
        reg.recordQualityAssessment(id, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 9000, 100, ASSESS_URI);
    }

    function test_quality_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.recordQualityAssessment(99, DataGovernanceRegistry.QualityStatus.PASSED, 9000, 9000, 100, ASSESS_URI);
    }

    // ─── recordBiasExamination ───────────────────────────────────────────────

    function test_bias_clear() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit DataGovernanceRegistry.BiasExamined(
            id, DataGovernanceRegistry.BiasStatus.CLEAR,
            "none", "gender,age,ethnicity", owner, block.timestamp
        );
        reg.recordBiasExamination(id, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "gender,age,ethnicity", "");

        DataGovernanceRegistry.BiasExamination memory b = reg.getBiasExamination(id);
        assertEq(uint(b.status), uint(DataGovernanceRegistry.BiasStatus.CLEAR));
        assertEq(b.biasTypes, "none");
        assertEq(b.affectedGroups, "gender,age,ethnicity");
        assertEq(b.examinedBy, owner);
    }

    function test_bias_mitigated() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.recordBiasExamination(
            id, DataGovernanceRegistry.BiasStatus.MITIGATED,
            "gender_bias,age_bias", "gender,age", MITIGATION
        );
        DataGovernanceRegistry.BiasExamination memory b = reg.getBiasExamination(id);
        assertEq(uint(b.status), uint(DataGovernanceRegistry.BiasStatus.MITIGATED));
        assertEq(b.biasTypes, "gender_bias,age_bias");
        assertEq(b.mitigationUri, MITIGATION);
    }

    function test_bias_canBeUpdated() public {
        uint256 id = _register();
        _bias(id, DataGovernanceRegistry.BiasStatus.BIASES_FOUND);
        _bias(id, DataGovernanceRegistry.BiasStatus.MITIGATED);
        assertEq(uint(reg.getBiasExamination(id).status), uint(DataGovernanceRegistry.BiasStatus.MITIGATED));
    }

    function test_bias_assessorCanRecord() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.setAssessor(id, assessor, true);
        vm.prank(assessor);
        reg.recordBiasExamination(id, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "gender", "");
        assertEq(reg.getBiasExamination(id).examinedBy, assessor);
    }

    function test_bias_revertsIfEmptyAffectedGroups() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(DataGovernanceRegistry.EmptyField.selector);
        reg.recordBiasExamination(id, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "", "");
    }

    function test_bias_revertsIfInactive() public {
        uint256 id = _register();
        vm.prank(owner);
        reg.deactivateDataset(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetInactive.selector, id));
        reg.recordBiasExamination(id, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "gender", "");
    }

    function test_bias_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.NotAuthorized.selector, stranger));
        reg.recordBiasExamination(id, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "gender", "");
    }

    function test_bias_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.recordBiasExamination(99, DataGovernanceRegistry.BiasStatus.CLEAR, "none", "gender", "");
    }

    // ─── deactivateDataset ───────────────────────────────────────────────────

    function test_deactivate_success() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit DataGovernanceRegistry.DatasetDeactivated(id, owner, block.timestamp);
        reg.deactivateDataset(id);
        assertFalse(reg.getDataset(id).active);
    }

    function test_deactivate_deployerCanDeactivate() public {
        uint256 id = _register();
        vm.prank(deployer);
        reg.deactivateDataset(id);
        assertFalse(reg.getDataset(id).active);
    }

    function test_deactivate_revertsIfUnauthorized() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.NotAuthorized.selector, stranger));
        reg.deactivateDataset(id);
    }

    function test_deactivate_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.deactivateDataset(99);
    }

    // ─── isDataReady ─────────────────────────────────────────────────────────

    function test_isDataReady_falseWhenFreshlyRegistered() public {
        uint256 id = _register();
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_falseWhenOnlyQualityPassed() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_falseWhenOnlyBiasClear() public {
        uint256 id = _register();
        _bias(id, DataGovernanceRegistry.BiasStatus.CLEAR);
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_trueWhenPassedAndClear() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        _bias(id, DataGovernanceRegistry.BiasStatus.CLEAR);
        assertTrue(reg.isDataReady(id));
    }

    function test_isDataReady_trueWhenPassedAndMitigated() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        _bias(id, DataGovernanceRegistry.BiasStatus.MITIGATED);
        assertTrue(reg.isDataReady(id));
    }

    function test_isDataReady_trueWhenConditionalAndClear() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.CONDITIONAL);
        _bias(id, DataGovernanceRegistry.BiasStatus.CLEAR);
        assertTrue(reg.isDataReady(id));
    }

    function test_isDataReady_falseWhenFailedQuality() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.FAILED);
        _bias(id, DataGovernanceRegistry.BiasStatus.CLEAR);
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_falseWhenBiasesFound() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        _bias(id, DataGovernanceRegistry.BiasStatus.BIASES_FOUND);
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_falseAfterDeactivation() public {
        uint256 id = _register();
        _quality(id, DataGovernanceRegistry.QualityStatus.PASSED);
        _bias(id, DataGovernanceRegistry.BiasStatus.CLEAR);
        assertTrue(reg.isDataReady(id));
        vm.prank(owner);
        reg.deactivateDataset(id);
        assertFalse(reg.isDataReady(id));
    }

    function test_isDataReady_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.isDataReady(99);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function test_getDataset_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.getDataset(99);
    }

    function test_getQualityAssessment_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.getQualityAssessment(99);
    }

    function test_getBiasExamination_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(DataGovernanceRegistry.DatasetNotFound.selector, 99));
        reg.getBiasExamination(99);
    }
}
