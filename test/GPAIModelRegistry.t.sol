// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/GPAIModelRegistry.sol";

contract GPAIModelRegistryTest is Test {

    GPAIModelRegistry public reg;

    address owner    = makeAddr("owner");
    address updater  = makeAddr("updater");
    address stranger = makeAddr("stranger");

    bytes32 constant MODEL_A = keccak256("modelA-v1");
    bytes32 constant MODEL_B = keccak256("modelB-v1");

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _closedParams(bytes32 modelId) internal pure returns (GPAIModelRegistry.RegisterParams memory) {
        return GPAIModelRegistry.RegisterParams({
            modelId:                modelId,
            name:                   "Acme-LLM",
            version:                "1.0",
            provider:               "AcmeCorp",
            isOpenSource:           false,
            hasSystemicRisk:        false,
            technicalDocUri:        "ipfs://tech-doc",
            copyrightPolicyUri:     "ipfs://copyright",
            trainingDataSummaryUri: "ipfs://training",
            downstreamInfoUri:      "ipfs://downstream",
            parameterCountM:        70000
        });
    }

    function _openParams(bytes32 modelId) internal pure returns (GPAIModelRegistry.RegisterParams memory) {
        return GPAIModelRegistry.RegisterParams({
            modelId:                modelId,
            name:                   "OpenLLM",
            version:                "2.0",
            provider:               "OpenOrg",
            isOpenSource:           true,
            hasSystemicRisk:        false,
            technicalDocUri:        "",   // exempted under Art. 53§2
            copyrightPolicyUri:     "ipfs://copyright-os",
            trainingDataSummaryUri: "ipfs://training-os",
            downstreamInfoUri:      "",   // exempted under Art. 53§2
            parameterCountM:        7000
        });
    }

    function _register(bytes32 modelId) internal returns (bytes32 id) {
        vm.prank(owner);
        id = reg.registerModel(_closedParams(modelId));
    }

    function _registerAndActivate(bytes32 modelId) internal returns (bytes32 id) {
        id = _register(modelId);
        vm.prank(owner);
        reg.activate(id);
    }

    function setUp() public {
        vm.prank(owner);
        reg = new GPAIModelRegistry();
    }

    // ─── Deployment ──────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(reg.deployer(), owner);
    }

    function test_modelCount_startsAtZero() public view {
        assertEq(reg.modelCount(), 0);
    }

    // ─── registerModel — closed source ────────────────────────────────────────

    function test_register_closedSource_happy() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.ModelRegistered(
            MODEL_A, "Acme-LLM", "1.0", false, false, owner, block.timestamp
        );
        bytes32 id = _register(MODEL_A);
        assertEq(id, MODEL_A);
        assertEq(reg.modelCount(), 1);
    }

    function test_register_populatesFields() public {
        _register(MODEL_A);
        GPAIModelRegistry.GPAIModel memory m = reg.getModel(MODEL_A);
        assertEq(m.name, "Acme-LLM");
        assertEq(m.version, "1.0");
        assertEq(m.provider, "AcmeCorp");
        assertFalse(m.isOpenSource);
        assertFalse(m.hasSystemicRisk);
        assertEq(m.technicalDocUri, "ipfs://tech-doc");
        assertEq(m.copyrightPolicyUri, "ipfs://copyright");
        assertEq(m.trainingDataSummaryUri, "ipfs://training");
        assertEq(m.downstreamInfoUri, "ipfs://downstream");
        assertEq(m.parameterCountM, 70000);
        assertEq(m.registeredBy, owner);
        assertEq(uint256(m.status), uint256(GPAIModelRegistry.ModelStatus.REGISTERED));
    }

    function test_register_revertsIfAlreadyRegistered() public {
        _register(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.AlreadyRegistered.selector, MODEL_A)
        );
        reg.registerModel(_closedParams(MODEL_A));
    }

    function test_register_revertsIfZeroModelId() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(bytes32(0));
        p.modelId = bytes32(0);
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.InvalidModelId.selector);
        reg.registerModel(p);
    }

    function test_register_revertsIfEmptyName() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.name = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_closedSource_revertsIfEmptyTechDoc() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.technicalDocUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_closedSource_revertsIfEmptyDownstream() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.downstreamInfoUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_revertsIfEmptyCopyrightPolicy() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.copyrightPolicyUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_revertsIfEmptyTrainingDataSummary() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.trainingDataSummaryUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    // ─── registerModel — open source ─────────────────────────────────────────

    function test_register_openSource_happy() public {
        vm.prank(owner);
        bytes32 id = reg.registerModel(_openParams(MODEL_A));
        assertEq(id, MODEL_A);
        GPAIModelRegistry.GPAIModel memory m = reg.getModel(MODEL_A);
        assertTrue(m.isOpenSource);
        assertEq(m.technicalDocUri, "");
        assertEq(m.downstreamInfoUri, "");
    }

    function test_register_openSource_requiresCopyrightPolicy() public {
        GPAIModelRegistry.RegisterParams memory p = _openParams(MODEL_A);
        p.copyrightPolicyUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_openSource_requiresTrainingDataSummary() public {
        GPAIModelRegistry.RegisterParams memory p = _openParams(MODEL_A);
        p.trainingDataSummaryUri = "";
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.registerModel(p);
    }

    function test_register_withSystemicRisk() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.hasSystemicRisk = true;
        vm.prank(owner);
        reg.registerModel(p);
        assertTrue(reg.getModel(MODEL_A).hasSystemicRisk);
    }

    function test_register_multipleModels() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.registerModel(_closedParams(MODEL_B));
        assertEq(reg.modelCount(), 2);
        assertEq(reg.getModelIds().length, 2);
    }

    // ─── activate / deprecate ─────────────────────────────────────────────────

    function test_activate_success() public {
        _register(MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.ModelActivated(MODEL_A, owner, block.timestamp);
        vm.prank(owner);
        reg.activate(MODEL_A);
        assertEq(uint256(reg.getModel(MODEL_A).status), uint256(GPAIModelRegistry.ModelStatus.ACTIVE));
    }

    function test_activate_revertsIfAlreadyActive() public {
        _registerAndActivate(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.InvalidStatus.selector, GPAIModelRegistry.ModelStatus.ACTIVE)
        );
        reg.activate(MODEL_A);
    }

    function test_activate_revertsIfDeprecated() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.AlreadyDeprecated.selector, MODEL_A)
        );
        reg.activate(MODEL_A);
    }

    function test_activate_revertsIfUnauthorized() public {
        _register(MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.NotAuthorized.selector, stranger)
        );
        reg.activate(MODEL_A);
    }

    function test_deprecate_success() public {
        _registerAndActivate(MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.ModelDeprecated(MODEL_A, owner, block.timestamp);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        assertEq(uint256(reg.getModel(MODEL_A).status), uint256(GPAIModelRegistry.ModelStatus.DEPRECATED));
    }

    function test_deprecate_revertsIfAlreadyDeprecated() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.AlreadyDeprecated.selector, MODEL_A)
        );
        reg.deprecate(MODEL_A);
    }

    function test_deprecate_revertsIfUnauthorized() public {
        _register(MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.NotAuthorized.selector, stranger)
        );
        reg.deprecate(MODEL_A);
    }

    // ─── Documentation Updates ────────────────────────────────────────────────

    function test_updateTechnicalDoc_success() public {
        _register(MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.DocumentationUpdated(MODEL_A, "technicalDoc", "ipfs://v2", owner, block.timestamp);
        vm.prank(owner);
        reg.updateTechnicalDoc(MODEL_A, "ipfs://v2");
        assertEq(reg.getModel(MODEL_A).technicalDocUri, "ipfs://v2");
    }

    function test_updateTechnicalDoc_revertsIfDeprecated() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.AlreadyDeprecated.selector, MODEL_A)
        );
        reg.updateTechnicalDoc(MODEL_A, "ipfs://v2");
    }

    function test_updateTechnicalDoc_revertsIfEmptyUri() public {
        _register(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(GPAIModelRegistry.EmptyField.selector);
        reg.updateTechnicalDoc(MODEL_A, "");
    }

    function test_updateCopyrightPolicy_success() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.updateCopyrightPolicy(MODEL_A, "ipfs://cp-v2");
        assertEq(reg.getModel(MODEL_A).copyrightPolicyUri, "ipfs://cp-v2");
    }

    function test_updateTrainingDataSummary_success() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.updateTrainingDataSummary(MODEL_A, "ipfs://td-v2");
        assertEq(reg.getModel(MODEL_A).trainingDataSummaryUri, "ipfs://td-v2");
    }

    function test_updateDownstreamInfo_success() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.updateDownstreamInfo(MODEL_A, "ipfs://ds-v2");
        assertEq(reg.getModel(MODEL_A).downstreamInfoUri, "ipfs://ds-v2");
    }

    function test_updates_revertsIfUnauthorized() public {
        _register(MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.NotAuthorized.selector, stranger)
        );
        reg.updateTechnicalDoc(MODEL_A, "ipfs://x");
    }

    function test_updateByUpdater() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.setUpdater(MODEL_A, updater, true);
        vm.prank(updater);
        reg.updateCopyrightPolicy(MODEL_A, "ipfs://cp-updater");
        assertEq(reg.getModel(MODEL_A).copyrightPolicyUri, "ipfs://cp-updater");
    }

    // ─── setSystemicRisk ──────────────────────────────────────────────────────

    function test_setSystemicRisk_flag() public {
        _register(MODEL_A);
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.SystemicRiskFlagChanged(MODEL_A, true, owner, block.timestamp);
        vm.prank(owner);
        reg.setSystemicRisk(MODEL_A, true);
        assertTrue(reg.getModel(MODEL_A).hasSystemicRisk);
    }

    function test_setSystemicRisk_unflag() public {
        GPAIModelRegistry.RegisterParams memory p = _closedParams(MODEL_A);
        p.hasSystemicRisk = true;
        vm.prank(owner);
        reg.registerModel(p);
        vm.prank(owner);
        reg.setSystemicRisk(MODEL_A, false);
        assertFalse(reg.getModel(MODEL_A).hasSystemicRisk);
    }

    function test_setSystemicRisk_revertsIfDeprecated() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.AlreadyDeprecated.selector, MODEL_A)
        );
        reg.setSystemicRisk(MODEL_A, true);
    }

    // ─── setUpdater ───────────────────────────────────────────────────────────

    function test_setUpdater_authorize() public {
        _register(MODEL_A);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(reg));
        emit GPAIModelRegistry.UpdaterSet(MODEL_A, updater, true, block.timestamp);
        reg.setUpdater(MODEL_A, updater, true);
        assertTrue(reg.updaters(MODEL_A, updater));
    }

    function test_setUpdater_revoke() public {
        _register(MODEL_A);
        vm.prank(owner);
        reg.setUpdater(MODEL_A, updater, true);
        vm.prank(owner);
        reg.setUpdater(MODEL_A, updater, false);
        assertFalse(reg.updaters(MODEL_A, updater));
    }

    function test_setUpdater_revertsIfUnauthorized() public {
        _register(MODEL_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.NotAuthorized.selector, stranger)
        );
        reg.setUpdater(MODEL_A, updater, true);
    }

    // ─── isArt53Compliant ─────────────────────────────────────────────────────

    function test_isCompliant_falseIfNotFound() public view {
        assertFalse(reg.isArt53Compliant(MODEL_A));
    }

    function test_isCompliant_falseIfRegisteredNotActive() public {
        _register(MODEL_A);
        assertFalse(reg.isArt53Compliant(MODEL_A));
    }

    function test_isCompliant_trueWhenActiveClosedSource() public {
        _registerAndActivate(MODEL_A);
        assertTrue(reg.isArt53Compliant(MODEL_A));
    }

    function test_isCompliant_trueWhenActiveOpenSource() public {
        vm.prank(owner);
        reg.registerModel(_openParams(MODEL_A));
        vm.prank(owner);
        reg.activate(MODEL_A);
        assertTrue(reg.isArt53Compliant(MODEL_A));
    }

    function test_isCompliant_falseAfterDeprecated() public {
        _registerAndActivate(MODEL_A);
        vm.prank(owner);
        reg.deprecate(MODEL_A);
        assertFalse(reg.isArt53Compliant(MODEL_A));
    }

    // ─── getModel ─────────────────────────────────────────────────────────────

    function test_getModel_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(GPAIModelRegistry.ModelNotFound.selector, MODEL_A)
        );
        reg.getModel(MODEL_A);
    }

    function test_deployerCanActOnAnyModel() public {
        vm.prank(stranger);
        reg.registerModel(_closedParams(MODEL_A));
        vm.prank(owner); // deployer
        reg.activate(MODEL_A);
        assertEq(uint256(reg.getModel(MODEL_A).status), uint256(GPAIModelRegistry.ModelStatus.ACTIVE));
    }
}
