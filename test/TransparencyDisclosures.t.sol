// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/TransparencyDisclosures.sol";

contract TransparencyDisclosuresTest is Test {

    TransparencyDisclosures public td;

    address owner     = makeAddr("owner");
    address registrar = makeAddr("registrar");
    address stranger  = makeAddr("stranger");

    bytes32 constant AGENT_A = keccak256("agentA");
    bytes32 constant AGENT_B = keccak256("agentB");

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _claim(address who, bytes32 agentId) internal {
        vm.prank(who);
        td.claimAgent(agentId);
    }

    function _register(
        address who,
        bytes32 agentId,
        TransparencyDisclosures.DisclosureCategory cat
    ) internal returns (uint256 id) {
        vm.prank(who);
        id = td.registerDisclosure(agentId, cat,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE,
            "ipfs://disclosure",
            ""
        );
    }

    function _registerChatbot(address who, bytes32 agentId) internal returns (uint256 id) {
        return _register(who, agentId, TransparencyDisclosures.DisclosureCategory.CHATBOT);
    }

    function setUp() public {
        vm.prank(owner);
        td = new TransparencyDisclosures();
    }

    // ─── Deployment ──────────────────────────────────────────────────────────

    function test_deployer_isSet() public view {
        assertEq(td.deployer(), owner);
    }

    function test_disclosureCount_startsAtZero() public view {
        assertEq(td.disclosureCount(), 0);
    }

    // ─── claimAgent ──────────────────────────────────────────────────────────

    function test_claimAgent_success() public {
        vm.expectEmit(true, false, false, true, address(td));
        emit TransparencyDisclosures.AgentClaimed(AGENT_A, stranger, block.timestamp);
        vm.prank(stranger);
        td.claimAgent(AGENT_A);
        assertEq(td.agentOwner(AGENT_A), stranger);
    }

    function test_claimAgent_revertsIfZeroId() public {
        vm.prank(owner);
        vm.expectRevert(TransparencyDisclosures.InvalidAgentId.selector);
        td.claimAgent(bytes32(0));
    }

    function test_claimAgent_revertsIfAlreadyClaimed() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.AgentAlreadyClaimed.selector, AGENT_A)
        );
        td.claimAgent(AGENT_A);
    }

    // ─── setRegistrar ────────────────────────────────────────────────────────

    function test_setRegistrar_authorize() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(td));
        emit TransparencyDisclosures.RegistrarSet(AGENT_A, registrar, true, block.timestamp);
        td.setRegistrar(AGENT_A, registrar, true);
        assertTrue(td.registrars(AGENT_A, registrar));
    }

    function test_setRegistrar_revoke() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        td.setRegistrar(AGENT_A, registrar, true);
        vm.prank(owner);
        td.setRegistrar(AGENT_A, registrar, false);
        assertFalse(td.registrars(AGENT_A, registrar));
    }

    function test_setRegistrar_revertsIfNotOwner() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.NotAuthorized.selector, stranger)
        );
        td.setRegistrar(AGENT_A, registrar, true);
    }

    // ─── registerDisclosure ───────────────────────────────────────────────────

    function test_registerDisclosure_happy() public {
        _claim(owner, AGENT_A);
        vm.expectEmit(true, true, false, true, address(td));
        emit TransparencyDisclosures.DisclosureRegistered(
            1, AGENT_A,
            TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE,
            owner, block.timestamp
        );
        uint256 id = _registerChatbot(owner, AGENT_A);
        assertEq(id, 1);
        assertEq(td.disclosureCount(), 1);
    }

    function test_registerDisclosure_populatesFields() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        TransparencyDisclosures.DisclosureRecord memory r = td.getDisclosure(id);
        assertEq(r.agentId, AGENT_A);
        assertEq(uint256(r.category), uint256(TransparencyDisclosures.DisclosureCategory.CHATBOT));
        assertEq(uint256(r.method), uint256(TransparencyDisclosures.DisclosureMethod.IN_INTERFACE));
        assertEq(uint256(r.status), uint256(TransparencyDisclosures.DisclosureStatus.REGISTERED));
        assertEq(r.implementationUri, "ipfs://disclosure");
        assertEq(r.registeredBy, owner);
    }

    function test_registerDisclosure_allCategories() public {
        _claim(owner, AGENT_A);
        for (uint256 i = 0; i < 6; i++) {
            _register(owner, AGENT_A, TransparencyDisclosures.DisclosureCategory(i));
        }
        assertEq(td.getAgentDisclosures(AGENT_A).length, 6);
    }

    function test_registerDisclosure_allMethods() public {
        _claim(owner, AGENT_A);
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(owner);
            td.registerDisclosure(
                AGENT_A,
                TransparencyDisclosures.DisclosureCategory.SYNTHETIC_CONTENT,
                TransparencyDisclosures.DisclosureMethod(i),
                "ipfs://d", ""
            );
        }
        assertEq(td.getAgentDisclosures(AGENT_A).length, 6);
    }

    function test_registerDisclosure_withExemption() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        uint256 id = td.registerDisclosure(
            AGENT_A,
            TransparencyDisclosures.DisclosureCategory.DEEP_FAKE,
            TransparencyDisclosures.DisclosureMethod.NOTIFICATION,
            "ipfs://evidence",
            "Law enforcement exemption per Art. 50-4"
        );
        assertEq(td.getDisclosure(id).exemptionBasis, "Law enforcement exemption per Art. 50-4");
    }

    function test_registerDisclosure_revertsIfEmptyUri() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(TransparencyDisclosures.EmptyField.selector);
        td.registerDisclosure(AGENT_A, TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE, "", "");
    }

    function test_registerDisclosure_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.NotAuthorized.selector, stranger)
        );
        td.registerDisclosure(AGENT_A, TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE, "ipfs://x", "");
    }

    function test_registerDisclosure_revertsIfZeroAgentId() public {
        vm.prank(owner);
        vm.expectRevert(TransparencyDisclosures.InvalidAgentId.selector);
        td.registerDisclosure(bytes32(0), TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE, "ipfs://x", "");
    }

    function test_registerDisclosure_registrarCanRegister() public {
        _claim(owner, AGENT_A);
        vm.prank(owner);
        td.setRegistrar(AGENT_A, registrar, true);
        vm.prank(registrar);
        td.registerDisclosure(AGENT_A, TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE, "ipfs://x", "");
        assertEq(td.getAgentDisclosures(AGENT_A).length, 1);
    }

    function test_deployerCanRegisterWithoutClaim() public {
        vm.prank(owner); // deployer
        td.registerDisclosure(AGENT_B, TransparencyDisclosures.DisclosureCategory.CHATBOT,
            TransparencyDisclosures.DisclosureMethod.IN_INTERFACE, "ipfs://x", "");
        assertEq(td.disclosureCount(), 1);
    }

    // ─── updateStatus ────────────────────────────────────────────────────────

    function test_updateStatus_toCompliant() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.expectEmit(true, false, false, true, address(td));
        emit TransparencyDisclosures.DisclosureStatusUpdated(
            id,
            TransparencyDisclosures.DisclosureStatus.REGISTERED,
            TransparencyDisclosures.DisclosureStatus.COMPLIANT,
            owner, block.timestamp
        );
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.COMPLIANT, "");
        assertEq(
            uint256(td.getDisclosure(id).status),
            uint256(TransparencyDisclosures.DisclosureStatus.COMPLIANT)
        );
    }

    function test_updateStatus_toExemptWithBasis() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.EXEMPT, "Art. 50-4 law enforcement");
        assertEq(td.getDisclosure(id).exemptionBasis, "Art. 50-4 law enforcement");
    }

    function test_updateStatus_toExempt_revertsIfNoBasis() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(TransparencyDisclosures.ExemptionRequiresBasis.selector);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.EXEMPT, "");
    }

    function test_updateStatus_toNonCompliant() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.NON_COMPLIANT, "");
        assertEq(
            uint256(td.getDisclosure(id).status),
            uint256(TransparencyDisclosures.DisclosureStatus.NON_COMPLIANT)
        );
    }

    function test_updateStatus_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.NotAuthorized.selector, stranger)
        );
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.COMPLIANT, "");
    }

    function test_updateStatus_revertsIfNotFound() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.DisclosureNotFound.selector, 99)
        );
        td.updateStatus(99, TransparencyDisclosures.DisclosureStatus.COMPLIANT, "");
    }

    // ─── updateImplementationUri ──────────────────────────────────────────────

    function test_updateImplementationUri_success() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.expectEmit(true, false, false, true, address(td));
        emit TransparencyDisclosures.DisclosureImplementationUpdated(id, "ipfs://v2", owner, block.timestamp);
        vm.prank(owner);
        td.updateImplementationUri(id, "ipfs://v2");
        assertEq(td.getDisclosure(id).implementationUri, "ipfs://v2");
    }

    function test_updateImplementationUri_revertsIfEmpty() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        vm.expectRevert(TransparencyDisclosures.EmptyField.selector);
        td.updateImplementationUri(id, "");
    }

    function test_updateImplementationUri_revertsIfUnauthorized() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.NotAuthorized.selector, stranger)
        );
        td.updateImplementationUri(id, "ipfs://v2");
    }

    // ─── countByStatus ────────────────────────────────────────────────────────

    function test_countByStatus_registeredInitially() public {
        _claim(owner, AGENT_A);
        _registerChatbot(owner, AGENT_A);
        _registerChatbot(owner, AGENT_A);
        assertEq(td.countByStatus(AGENT_A, TransparencyDisclosures.DisclosureStatus.REGISTERED), 2);
        assertEq(td.countByStatus(AGENT_A, TransparencyDisclosures.DisclosureStatus.COMPLIANT), 0);
    }

    function test_countByStatus_afterUpdate() public {
        _claim(owner, AGENT_A);
        uint256 id1 = _registerChatbot(owner, AGENT_A);
        uint256 id2 = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id1, TransparencyDisclosures.DisclosureStatus.COMPLIANT, "");
        vm.prank(owner);
        td.updateStatus(id2, TransparencyDisclosures.DisclosureStatus.NON_COMPLIANT, "");
        assertEq(td.countByStatus(AGENT_A, TransparencyDisclosures.DisclosureStatus.REGISTERED), 0);
        assertEq(td.countByStatus(AGENT_A, TransparencyDisclosures.DisclosureStatus.COMPLIANT), 1);
        assertEq(td.countByStatus(AGENT_A, TransparencyDisclosures.DisclosureStatus.NON_COMPLIANT), 1);
    }

    // ─── isArt50Compliant ─────────────────────────────────────────────────────

    function test_isCompliant_falseWhenNoDisclosures() public view {
        assertFalse(td.isArt50Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenOnlyRegistered() public {
        _claim(owner, AGENT_A);
        _registerChatbot(owner, AGENT_A);
        assertFalse(td.isArt50Compliant(AGENT_A));
    }

    function test_isCompliant_falseWhenOnlyNonCompliant() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.NON_COMPLIANT, "");
        assertFalse(td.isArt50Compliant(AGENT_A));
    }

    function test_isCompliant_trueWhenCompliant() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.COMPLIANT, "");
        assertTrue(td.isArt50Compliant(AGENT_A));
    }

    function test_isCompliant_trueWhenExempt() public {
        _claim(owner, AGENT_A);
        uint256 id = _registerChatbot(owner, AGENT_A);
        vm.prank(owner);
        td.updateStatus(id, TransparencyDisclosures.DisclosureStatus.EXEMPT, "law-enforcement");
        assertTrue(td.isArt50Compliant(AGENT_A));
    }

    // ─── getDisclosure ────────────────────────────────────────────────────────

    function test_getDisclosure_revertsIfNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(TransparencyDisclosures.DisclosureNotFound.selector, 1)
        );
        td.getDisclosure(1);
    }

    function test_getAgentDisclosures_empty() public view {
        assertEq(td.getAgentDisclosures(AGENT_A).length, 0);
    }

    function test_multipleAgents() public {
        _claim(owner, AGENT_A);
        _claim(stranger, AGENT_B);
        _registerChatbot(owner, AGENT_A);
        _registerChatbot(owner, AGENT_A);
        _register(stranger, AGENT_B, TransparencyDisclosures.DisclosureCategory.DEEP_FAKE);
        assertEq(td.getAgentDisclosures(AGENT_A).length, 2);
        assertEq(td.getAgentDisclosures(AGENT_B).length, 1);
        assertEq(td.disclosureCount(), 3);
    }
}
