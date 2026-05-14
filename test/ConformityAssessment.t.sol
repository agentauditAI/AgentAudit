// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/ConformityAssessment.sol";

contract ConformityAssessmentTest is Test {

    ConformityAssessment public ca;

    address deployer  = makeAddr("deployer");
    address provider  = makeAddr("provider");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_ID  = keccak256("agent-001");
    bytes32 constant AGENT_ID2 = keccak256("agent-002");

    string constant PROVIDER_NAME  = "Acme AI GmbH";
    string constant PROVIDER_ADDR  = "Unter den Linden 1, 10117 Berlin, DE";
    string constant SYS_DESC       = "Automated CV screening for recruitment";
    string constant NB_NAME        = "TUV SUD Product Service GmbH";
    string constant NB_REF         = "NB-2345";
    string constant CERT_REF       = "EU-AI-2026-00099";
    string constant STANDARDS      = "EN ISO/IEC 42001:2023, ETSI EN 303 645";
    string constant DECL_URI       = "ipfs://QmDeclaration123";
    string constant NEW_DECL_URI   = "ipfs://QmDeclarationV2";
    string constant WITHDRAWAL_RSN = "Substantial modification requires new assessment";

    uint256 immutable VALID_FROM;
    uint256 immutable VALID_UNTIL;

    constructor() {
        VALID_FROM  = block.timestamp;
        VALID_UNTIL = block.timestamp + 365 days;
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(deployer);
        ca = new ConformityAssessment();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _selfParams(bytes32 agentId) internal view returns (ConformityAssessment.RegisterParams memory) {
        return ConformityAssessment.RegisterParams({
            agentId:          agentId,
            assessmentType:   ConformityAssessment.AssessmentType.SELF_ASSESSMENT,
            providerName:     PROVIDER_NAME,
            providerAddress:  PROVIDER_ADDR,
            systemDescription: SYS_DESC,
            notifiedBodyName: "",
            notifiedBodyRef:  "",
            certificateRef:   "",
            standardsApplied: STANDARDS,
            declarationUri:   DECL_URI,
            validFrom:        VALID_FROM,
            validUntil:       VALID_UNTIL
        });
    }

    function _nbParams(bytes32 agentId) internal view returns (ConformityAssessment.RegisterParams memory) {
        return ConformityAssessment.RegisterParams({
            agentId:          agentId,
            assessmentType:   ConformityAssessment.AssessmentType.NOTIFIED_BODY,
            providerName:     PROVIDER_NAME,
            providerAddress:  PROVIDER_ADDR,
            systemDescription: SYS_DESC,
            notifiedBodyName: NB_NAME,
            notifiedBodyRef:  NB_REF,
            certificateRef:   CERT_REF,
            standardsApplied: STANDARDS,
            declarationUri:   DECL_URI,
            validFrom:        VALID_FROM,
            validUntil:       VALID_UNTIL
        });
    }

    function _register() internal {
        vm.prank(provider);
        ca.register(_selfParams(AGENT_ID));
    }

    function _registerNB() internal {
        vm.prank(provider);
        ca.register(_nbParams(AGENT_ID));
    }

    function _certify() internal {
        _register();
        vm.prank(provider);
        ca.certify(AGENT_ID);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(ca.deployer(), deployer);
    }

    function test_maxValidity_is5Years() public view {
        assertEq(ca.MAX_VALIDITY(), 1825 days);
    }

    function test_registeredCount_startsAtZero() public view {
        assertEq(ca.getRegisteredCount(), 0);
    }

    // ─── register ────────────────────────────────────────────────────────────

    function test_register_selfAssessment() public {
        vm.prank(provider);
        vm.expectEmit(true, false, false, true);
        emit ConformityAssessment.ConformityRegistered(
            AGENT_ID,
            ConformityAssessment.AssessmentType.SELF_ASSESSMENT,
            DECL_URI, VALID_UNTIL, provider, block.timestamp
        );
        ca.register(_selfParams(AGENT_ID));

        ConformityAssessment.ConformityRecord memory r = ca.getRecord(AGENT_ID);
        assertEq(r.agentId, AGENT_ID);
        assertEq(uint(r.assessmentType), uint(ConformityAssessment.AssessmentType.SELF_ASSESSMENT));
        assertEq(uint(r.status), uint(ConformityAssessment.ConformityStatus.PENDING));
        assertEq(r.providerName, PROVIDER_NAME);
        assertEq(r.providerAddress, PROVIDER_ADDR);
        assertEq(r.systemDescription, SYS_DESC);
        assertEq(r.standardsApplied, STANDARDS);
        assertEq(r.declarationUri, DECL_URI);
        assertEq(r.validFrom, VALID_FROM);
        assertEq(r.validUntil, VALID_UNTIL);
        assertEq(r.registeredBy, provider);
        assertEq(r.registeredAt, block.timestamp);
    }

    function test_register_notifiedBody() public {
        _registerNB();
        ConformityAssessment.ConformityRecord memory r = ca.getRecord(AGENT_ID);
        assertEq(uint(r.assessmentType), uint(ConformityAssessment.AssessmentType.NOTIFIED_BODY));
        assertEq(r.notifiedBodyName, NB_NAME);
        assertEq(r.notifiedBodyRef, NB_REF);
        assertEq(r.certificateRef, CERT_REF);
    }

    function test_register_appendsToList() public {
        _register();
        vm.prank(provider);
        ca.register(_selfParams(AGENT_ID2));
        assertEq(ca.getRegisteredCount(), 2);
        bytes32[] memory agents = ca.getRegisteredAgents();
        assertEq(agents[0], AGENT_ID);
        assertEq(agents[1], AGENT_ID2);
    }

    function test_register_revertsIfZeroAgentId() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(bytes32(0));
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.InvalidAgentId.selector);
        ca.register(p);
    }

    function test_register_revertsIfAlreadyRegistered() public {
        _register();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyRegistered.selector, AGENT_ID));
        ca.register(_selfParams(AGENT_ID));
    }

    function test_register_revertsIfEmptyProviderName() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(AGENT_ID);
        p.providerName = "";
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.EmptyField.selector);
        ca.register(p);
    }

    function test_register_revertsIfEmptyDeclarationUri() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(AGENT_ID);
        p.declarationUri = "";
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.EmptyField.selector);
        ca.register(p);
    }

    function test_register_revertsIfValidUntilNotAfterFrom() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(AGENT_ID);
        p.validUntil = p.validFrom;
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(
            ConformityAssessment.InvalidValidityPeriod.selector, p.validFrom, p.validUntil
        ));
        ca.register(p);
    }

    function test_register_revertsIfExceedsMaxValidity() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(AGENT_ID);
        p.validUntil = p.validFrom + 1826 days;
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(
            ConformityAssessment.ExceedsMaxValidity.selector, uint256(1826 days), ca.MAX_VALIDITY()
        ));
        ca.register(p);
    }

    function test_register_notifiedBody_revertsIfMissingName() public {
        ConformityAssessment.RegisterParams memory p = _nbParams(AGENT_ID);
        p.notifiedBodyName = "";
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.NotifiedBodyRequired.selector);
        ca.register(p);
    }

    function test_register_notifiedBody_revertsIfMissingRef() public {
        ConformityAssessment.RegisterParams memory p = _nbParams(AGENT_ID);
        p.notifiedBodyRef = "";
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.NotifiedBodyRequired.selector);
        ca.register(p);
    }

    function test_register_maxValidityExact() public {
        ConformityAssessment.RegisterParams memory p = _selfParams(AGENT_ID);
        p.validUntil = p.validFrom + 1825 days;
        vm.prank(provider);
        ca.register(p); // should not revert
        assertEq(ca.getRecord(AGENT_ID).validUntil, p.validFrom + 1825 days);
    }

    // ─── certify ─────────────────────────────────────────────────────────────

    function test_certify_success() public {
        _register();
        vm.prank(provider);
        vm.expectEmit(true, false, false, true);
        emit ConformityAssessment.ConformityCertified(AGENT_ID, provider, block.timestamp);
        ca.certify(AGENT_ID);

        assertEq(uint(ca.getRecord(AGENT_ID).status), uint(ConformityAssessment.ConformityStatus.CERTIFIED));
    }

    function test_certify_deployerCanCertify() public {
        _register();
        vm.prank(deployer);
        ca.certify(AGENT_ID);
        assertEq(uint(ca.getRecord(AGENT_ID).status), uint(ConformityAssessment.ConformityStatus.CERTIFIED));
    }

    function test_certify_revertsIfAlreadyCertified() public {
        _certify();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyCertified.selector, AGENT_ID));
        ca.certify(AGENT_ID);
    }

    function test_certify_revertsIfWithdrawn() public {
        _register();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyWithdrawn.selector, AGENT_ID));
        ca.certify(AGENT_ID);
    }

    function test_certify_revertsIfExpired() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        ca.checkExpiry(AGENT_ID);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyExpired.selector, AGENT_ID));
        ca.certify(AGENT_ID);
    }

    function test_certify_revertsIfUnauthorized() public {
        _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.NotAuthorized.selector, stranger));
        ca.certify(AGENT_ID);
    }

    function test_certify_revertsIfNotFound() public {
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.NotFound.selector, AGENT_ID));
        ca.certify(AGENT_ID);
    }

    // ─── withdraw ────────────────────────────────────────────────────────────

    function test_withdraw_fromPending() public {
        _register();
        vm.prank(provider);
        vm.expectEmit(true, false, false, true);
        emit ConformityAssessment.ConformityWithdrawn(AGENT_ID, provider, WITHDRAWAL_RSN, block.timestamp);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);

        ConformityAssessment.ConformityRecord memory r = ca.getRecord(AGENT_ID);
        assertEq(uint(r.status), uint(ConformityAssessment.ConformityStatus.WITHDRAWN));
        assertEq(r.withdrawalReason, WITHDRAWAL_RSN);
    }

    function test_withdraw_fromCertified() public {
        _certify();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        assertEq(uint(ca.getRecord(AGENT_ID).status), uint(ConformityAssessment.ConformityStatus.WITHDRAWN));
    }

    function test_withdraw_revertsIfAlreadyWithdrawn() public {
        _register();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyWithdrawn.selector, AGENT_ID));
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
    }

    function test_withdraw_revertsIfExpired() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        ca.checkExpiry(AGENT_ID);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyExpired.selector, AGENT_ID));
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
    }

    function test_withdraw_revertsIfEmptyReason() public {
        _register();
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.EmptyField.selector);
        ca.withdraw(AGENT_ID, "");
    }

    function test_withdraw_revertsIfUnauthorized() public {
        _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.NotAuthorized.selector, stranger));
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
    }

    // ─── checkExpiry ─────────────────────────────────────────────────────────

    function test_checkExpiry_success() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        vm.expectEmit(true, false, false, true);
        emit ConformityAssessment.ConformityExpired(AGENT_ID, VALID_UNTIL, block.timestamp);
        ca.checkExpiry(AGENT_ID);
        assertEq(uint(ca.getRecord(AGENT_ID).status), uint(ConformityAssessment.ConformityStatus.EXPIRED));
    }

    function test_checkExpiry_permissionless() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        vm.prank(stranger);
        ca.checkExpiry(AGENT_ID); // anyone can call
        assertEq(uint(ca.getRecord(AGENT_ID).status), uint(ConformityAssessment.ConformityStatus.EXPIRED));
    }

    function test_checkExpiry_revertsIfNotYetExpired() public {
        _register();
        vm.expectRevert(abi.encodeWithSelector(
            ConformityAssessment.InvalidValidityPeriod.selector, block.timestamp, VALID_UNTIL
        ));
        ca.checkExpiry(AGENT_ID);
    }

    function test_checkExpiry_revertsIfAlreadyExpired() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        ca.checkExpiry(AGENT_ID);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyExpired.selector, AGENT_ID));
        ca.checkExpiry(AGENT_ID);
    }

    function test_checkExpiry_revertsIfWithdrawn() public {
        _register();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        vm.warp(VALID_UNTIL + 1);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyWithdrawn.selector, AGENT_ID));
        ca.checkExpiry(AGENT_ID);
    }

    // ─── updateDeclaration ────────────────────────────────────────────────────

    function test_updateDeclaration_success() public {
        _register();
        vm.prank(provider);
        vm.expectEmit(true, false, false, true);
        emit ConformityAssessment.DeclarationUpdated(AGENT_ID, NEW_DECL_URI, block.timestamp);
        ca.updateDeclaration(AGENT_ID, NEW_DECL_URI);
        assertEq(ca.getRecord(AGENT_ID).declarationUri, NEW_DECL_URI);
    }

    function test_updateDeclaration_whileCertified() public {
        _certify();
        vm.prank(provider);
        ca.updateDeclaration(AGENT_ID, NEW_DECL_URI);
        assertEq(ca.getRecord(AGENT_ID).declarationUri, NEW_DECL_URI);
    }

    function test_updateDeclaration_revertsIfWithdrawn() public {
        _register();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyWithdrawn.selector, AGENT_ID));
        ca.updateDeclaration(AGENT_ID, NEW_DECL_URI);
    }

    function test_updateDeclaration_revertsIfExpired() public {
        _register();
        vm.warp(VALID_UNTIL + 1);
        ca.checkExpiry(AGENT_ID);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.AlreadyExpired.selector, AGENT_ID));
        ca.updateDeclaration(AGENT_ID, NEW_DECL_URI);
    }

    function test_updateDeclaration_revertsIfEmptyUri() public {
        _register();
        vm.prank(provider);
        vm.expectRevert(ConformityAssessment.EmptyField.selector);
        ca.updateDeclaration(AGENT_ID, "");
    }

    function test_updateDeclaration_revertsIfUnauthorized() public {
        _register();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.NotAuthorized.selector, stranger));
        ca.updateDeclaration(AGENT_ID, NEW_DECL_URI);
    }

    // ─── isValid ─────────────────────────────────────────────────────────────

    function test_isValid_falseIfPending() public {
        _register();
        assertFalse(ca.isValid(AGENT_ID));
    }

    function test_isValid_trueIfCertifiedAndNotExpired() public {
        _certify();
        assertTrue(ca.isValid(AGENT_ID));
    }

    function test_isValid_falseIfCertifiedButExpired() public {
        _certify();
        vm.warp(VALID_UNTIL + 1);
        assertFalse(ca.isValid(AGENT_ID));
    }

    function test_isValid_falseIfWithdrawn() public {
        _certify();
        vm.prank(provider);
        ca.withdraw(AGENT_ID, WITHDRAWAL_RSN);
        assertFalse(ca.isValid(AGENT_ID));
    }

    function test_isValid_falseIfNotRegistered() public view {
        assertFalse(ca.isValid(AGENT_ID));
    }

    function test_isValid_falseAfterCheckExpiry() public {
        _certify();
        vm.warp(VALID_UNTIL + 1);
        ca.checkExpiry(AGENT_ID);
        assertFalse(ca.isValid(AGENT_ID));
    }

    // ─── getRecord ────────────────────────────────────────────────────────────

    function test_getRecord_revertsIfNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(ConformityAssessment.NotFound.selector, AGENT_ID));
        ca.getRecord(AGENT_ID);
    }
}
