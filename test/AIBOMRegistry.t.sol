// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AIBOMRegistry.sol";

contract AIBOMRegistryTest is Test {

    AIBOMRegistry public registry;

    address deployer  = makeAddr("deployer");
    address registrar = makeAddr("registrar");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_ID  = keccak256("agent-001");
    bytes32 constant AGENT_ID2 = keccak256("agent-002");

    string constant BOM_URI     = "ipfs://QmCycloneDX1234";
    string constant SERIAL      = "urn:uuid:550e8400-e29b-41d4-a716-446655440000";
    string constant MODEL_NAME  = "claude-3-opus";
    string constant MODEL_VER   = "1.0.0";
    string constant PURPOSE     = "HR screening decision support";
    string constant SUPPLIER    = "Anthropic PBC";
    string constant DATASET_URI = "ipfs://QmDataset5678";
    string constant PERF_URI    = "ipfs://QmPerformance9999";

    AIBOMRegistry.RiskCategory constant RISK = AIBOMRegistry.RiskCategory.HIGH_RISK;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        registry = new AIBOMRegistry();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _params(bytes32 agentId) internal pure returns (AIBOMRegistry.RegisterParams memory) {
        return AIBOMRegistry.RegisterParams({
            agentId:         agentId,
            bomUri:          BOM_URI,
            serialNumber:    SERIAL,
            modelName:       MODEL_NAME,
            modelVersion:    MODEL_VER,
            intendedPurpose: PURPOSE,
            supplierName:    SUPPLIER,
            riskCategory:    RISK,
            datasetUri:      DATASET_URI,
            performanceUri:  PERF_URI
        });
    }

    function _register() internal {
        vm.prank(registrar);
        registry.register(_params(AGENT_ID));
    }

    function _register(bytes32 agentId) internal {
        vm.prank(registrar);
        registry.register(_params(agentId));
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(registry.deployer(), deployer);
    }

    // ─── Register ────────────────────────────────────────────────────────────

    function test_register_success() public {
        _register();
        AIBOMRegistry.AIBOM memory bom = registry.getAIBOM(AGENT_ID);
        assertEq(bom.agentId,         AGENT_ID);
        assertEq(bom.bomUri,          BOM_URI);
        assertEq(bom.serialNumber,    SERIAL);
        assertEq(bom.bomVersion,      1);
        assertEq(bom.modelName,       MODEL_NAME);
        assertEq(bom.modelVersion,    MODEL_VER);
        assertEq(bom.intendedPurpose, PURPOSE);
        assertEq(bom.supplierName,    SUPPLIER);
        assertEq(uint(bom.riskCategory), uint(RISK));
        assertEq(bom.datasetUri,      DATASET_URI);
        assertEq(bom.performanceUri,  PERF_URI);
        assertEq(bom.registeredBy,    registrar);
        assertEq(bom.registeredAt,    block.timestamp);
        assertEq(bom.updatedAt,       block.timestamp);
        assertTrue(bom.active);
    }

    function test_register_emitsEvent() public {
        vm.prank(registrar);
        vm.expectEmit(true, false, false, true);
        emit AIBOMRegistry.AIBOMRegistered(
            AGENT_ID, BOM_URI, SERIAL, RISK, registrar, block.timestamp
        );
        registry.register(_params(AGENT_ID));
    }

    function test_register_incrementsCount() public {
        assertEq(registry.getRegisteredCount(), 0);
        _register();
        assertEq(registry.getRegisteredCount(), 1);
        _register(AGENT_ID2);
        assertEq(registry.getRegisteredCount(), 2);
    }

    function test_register_appendsToAgentList() public {
        _register();
        _register(AGENT_ID2);
        bytes32[] memory agents = registry.getRegisteredAgents();
        assertEq(agents.length, 2);
        assertEq(agents[0], AGENT_ID);
        assertEq(agents[1], AGENT_ID2);
    }

    function test_register_revertsIfZeroAgentId() public {
        AIBOMRegistry.RegisterParams memory p = _params(bytes32(0));
        vm.prank(registrar);
        vm.expectRevert(AIBOMRegistry.InvalidAgentId.selector);
        registry.register(p);
    }

    function test_register_revertsIfEmptyBomUri() public {
        AIBOMRegistry.RegisterParams memory p = _params(AGENT_ID);
        p.bomUri = "";
        vm.prank(registrar);
        vm.expectRevert(AIBOMRegistry.EmptyBomUri.selector);
        registry.register(p);
    }

    function test_register_revertsIfAlreadyRegistered() public {
        _register();
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.AlreadyRegistered.selector, AGENT_ID));
        registry.register(_params(AGENT_ID));
    }

    function test_register_minimalRisk() public {
        AIBOMRegistry.RegisterParams memory p = _params(AGENT_ID);
        p.riskCategory = AIBOMRegistry.RiskCategory.MINIMAL_RISK;
        vm.prank(registrar);
        registry.register(p);
        assertEq(
            uint(registry.getAIBOM(AGENT_ID).riskCategory),
            uint(AIBOMRegistry.RiskCategory.MINIMAL_RISK)
        );
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    function test_update_success() public {
        _register();
        string memory newUri = "ipfs://QmNewBOM9999";
        vm.prank(registrar);
        registry.update(AGENT_ID, newUri);

        AIBOMRegistry.AIBOM memory bom = registry.getAIBOM(AGENT_ID);
        assertEq(bom.bomUri,     newUri);
        assertEq(bom.bomVersion, 2);
    }

    function test_update_emitsEvent() public {
        _register();
        string memory newUri = "ipfs://QmNewBOM9999";
        vm.prank(registrar);
        vm.expectEmit(true, false, false, true);
        emit AIBOMRegistry.AIBOMUpdated(AGENT_ID, newUri, 2, block.timestamp);
        registry.update(AGENT_ID, newUri);
    }

    function test_update_archivesOldUriHash() public {
        _register();
        bytes32 expectedHash = keccak256(bytes(BOM_URI));
        vm.prank(registrar);
        registry.update(AGENT_ID, "ipfs://QmNewBOM9999");

        bytes32[] memory hist = registry.getHistory(AGENT_ID);
        assertEq(hist.length, 1);
        assertEq(hist[0], expectedHash);
    }

    function test_update_multipleVersions() public {
        _register();
        vm.prank(registrar);
        registry.update(AGENT_ID, "ipfs://QmV2");
        vm.prank(registrar);
        registry.update(AGENT_ID, "ipfs://QmV3");

        AIBOMRegistry.AIBOM memory bom = registry.getAIBOM(AGENT_ID);
        assertEq(bom.bomVersion, 3);

        bytes32[] memory hist = registry.getHistory(AGENT_ID);
        assertEq(hist.length, 2);
    }

    function test_update_deployerCanUpdate() public {
        _register();
        vm.prank(deployer);
        registry.update(AGENT_ID, "ipfs://QmDeployerUpdate");
        assertEq(registry.getAIBOM(AGENT_ID).bomUri, "ipfs://QmDeployerUpdate");
    }

    function test_update_revertsIfNotFound() public {
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotFound.selector, AGENT_ID));
        registry.update(AGENT_ID, "ipfs://QmX");
    }

    function test_update_revertsIfNotActive() public {
        _register();
        vm.prank(registrar);
        registry.deactivate(AGENT_ID);

        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotActive.selector, AGENT_ID));
        registry.update(AGENT_ID, "ipfs://QmX");
    }

    function test_update_revertsIfUnauthorized() public {
        _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotAuthorized.selector, stranger));
        registry.update(AGENT_ID, "ipfs://QmX");
    }

    // ─── Deactivate ──────────────────────────────────────────────────────────

    function test_deactivate_success() public {
        _register();
        vm.prank(registrar);
        registry.deactivate(AGENT_ID);
        assertFalse(registry.getAIBOM(AGENT_ID).active);
    }

    function test_deactivate_emitsEvent() public {
        _register();
        vm.prank(registrar);
        vm.expectEmit(true, false, false, true);
        emit AIBOMRegistry.AIBOMDeactivated(AGENT_ID, registrar, block.timestamp);
        registry.deactivate(AGENT_ID);
    }

    function test_deactivate_deployerCanDeactivate() public {
        _register();
        vm.prank(deployer);
        registry.deactivate(AGENT_ID);
        assertFalse(registry.getAIBOM(AGENT_ID).active);
    }

    function test_deactivate_revertsIfNotFound() public {
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotFound.selector, AGENT_ID));
        registry.deactivate(AGENT_ID);
    }

    function test_deactivate_revertsIfAlreadyInactive() public {
        _register();
        vm.prank(registrar);
        registry.deactivate(AGENT_ID);

        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotActive.selector, AGENT_ID));
        registry.deactivate(AGENT_ID);
    }

    function test_deactivate_revertsIfUnauthorized() public {
        _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotAuthorized.selector, stranger));
        registry.deactivate(AGENT_ID);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function test_getAIBOM_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotFound.selector, AGENT_ID));
        registry.getAIBOM(AGENT_ID);
    }

    function test_getHistory_emptyOnFreshRegistration() public {
        _register();
        bytes32[] memory hist = registry.getHistory(AGENT_ID);
        assertEq(hist.length, 0);
    }

    function test_getHistory_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(AIBOMRegistry.NotFound.selector, AGENT_ID));
        registry.getHistory(AGENT_ID);
    }

    function test_getRegisteredCount_startsAtZero() public view {
        assertEq(registry.getRegisteredCount(), 0);
    }

    function test_getRegisteredAgents_empty() public view {
        assertEq(registry.getRegisteredAgents().length, 0);
    }

    // ─── Annex IV fields ─────────────────────────────────────────────────────

    function test_register_storesAnnexIVFields() public {
        _register();
        AIBOMRegistry.AIBOM memory bom = registry.getAIBOM(AGENT_ID);
        assertEq(bom.intendedPurpose, PURPOSE);
        assertEq(bom.datasetUri,      DATASET_URI);
        assertEq(bom.performanceUri,  PERF_URI);
        assertEq(bom.supplierName,    SUPPLIER);
    }

    function test_register_allRiskCategories() public {
        AIBOMRegistry.RiskCategory[4] memory cats = [
            AIBOMRegistry.RiskCategory.MINIMAL_RISK,
            AIBOMRegistry.RiskCategory.LIMITED_RISK,
            AIBOMRegistry.RiskCategory.HIGH_RISK,
            AIBOMRegistry.RiskCategory.UNACCEPTABLE_RISK
        ];
        bytes32[4] memory ids = [
            keccak256("r0"), keccak256("r1"), keccak256("r2"), keccak256("r3")
        ];
        for (uint i = 0; i < 4; i++) {
            AIBOMRegistry.RegisterParams memory p = _params(ids[i]);
            p.riskCategory = cats[i];
            vm.prank(registrar);
            registry.register(p);
            assertEq(uint(registry.getAIBOM(ids[i]).riskCategory), uint(cats[i]));
        }
    }
}
