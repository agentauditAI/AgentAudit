// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AgentIdentityRegistry.sol";
import "../contracts/v2/AgentRegistration.sol";

contract AgentIdentityRegistryTest is Test {

    // Redeclared for vm.expectEmit
    event AgentIdentityRegistered(
        address         indexed agentId,
        address         indexed developer,
        string          name,
        string          version,
        AgentIdentityRegistry.ComplianceLevel complianceLevel,
        uint256         registrationId,
        uint256         timestamp
    );
    event CapabilitiesUpdated(
        address indexed agentId,
        bytes32 indexed newCapabilitiesHash,
        bytes32         previousHash,
        uint256         timestamp
    );
    event AgentIdentityRevoked(
        address indexed agentId,
        address indexed developer,
        uint256         timestamp
    );

    AgentIdentityRegistry public registry;
    AgentRegistration     public agentReg;

    address public dev   = address(0xDEAD);
    address public dev2  = address(0xBEEF);
    address public agentA = address(0x1111);
    address public agentB = address(0x2222);

    bytes32 constant CAP_HASH  = keccak256("capabilities-manifest-v1");
    bytes32 constant CAP_HASH2 = keccak256("capabilities-manifest-v2");

    function setUp() public {
        agentReg = new AgentRegistration();
        registry = new AgentIdentityRegistry(address(agentReg));
    }

    // ─────────────────────────────────────────────
    // Standalone registration (registrationId = 0)
    // ─────────────────────────────────────────────

    function test_Register_Standalone_Success() public {
        vm.prank(dev);
        registry.registerAgentIdentity(
            agentA, "TradingBot-v2", "1.2.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, 0
        );

        assertTrue(registry.isIdentityRegistered(agentA));
        assertTrue(registry.isActive(agentA));
        assertEq(registry.identityCount(), 1);
    }

    function test_Register_Standalone_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit AgentIdentityRegistered(
            agentA, dev, "TradingBot-v2", "1.2.0",
            AgentIdentityRegistry.ComplianceLevel.LIMITED, 0, block.timestamp
        );

        vm.prank(dev);
        registry.registerAgentIdentity(
            agentA, "TradingBot-v2", "1.2.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, 0
        );
    }

    function test_Register_SetsCorrectFields() public {
        vm.prank(dev);
        registry.registerAgentIdentity(
            agentA, "TradingBot-v2", "1.2.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.HIGH, 0
        );

        AgentIdentityRegistry.AgentIdentity memory id = registry.getAgentIdentity(agentA);
        assertEq(id.name,             "TradingBot-v2");
        assertEq(id.version,          "1.2.0");
        assertEq(id.developer,        dev);
        assertEq(id.capabilitiesHash, CAP_HASH);
        assertEq(uint(id.complianceLevel), uint(AgentIdentityRegistry.ComplianceLevel.HIGH));
        assertEq(id.registrationId,   0);
        assertTrue(id.active);
        assertEq(id.registeredAt, block.timestamp);
        assertEq(id.updatedAt,    block.timestamp);
    }

    function test_Register_Reverts_AlreadyRegistered() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.expectRevert("AgentIdentityRegistry: already registered");
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        vm.stopPrank();
    }

    function test_Register_Reverts_EmptyName() public {
        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: empty name");
        registry.registerAgentIdentity(agentA, "", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
    }

    function test_Register_Reverts_EmptyVersion() public {
        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: empty version");
        registry.registerAgentIdentity(agentA, "BotA", "", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
    }

    function test_Register_Reverts_EmptyCapabilitiesHash() public {
        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: empty capabilitiesHash");
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", bytes32(0),
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
    }

    function test_Register_MultipleAgents_CountsCorrectly() public {
        vm.prank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.prank(dev2);
        registry.registerAgentIdentity(agentB, "BotB", "2.0.0", CAP_HASH2,
            AgentIdentityRegistry.ComplianceLevel.CRITICAL, 0);

        assertEq(registry.identityCount(), 2);
    }

    // ─────────────────────────────────────────────
    // Linked registration (registrationId > 0)
    // ─────────────────────────────────────────────

    function test_Register_Linked_Success() public {
        vm.prank(dev);
        uint256 regId = agentReg.registerAgent("BotA", "limited", 1 ether, address(0));

        vm.prank(dev);
        registry.registerAgentIdentity(
            agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, regId
        );

        AgentIdentityRegistry.AgentIdentity memory id = registry.getAgentIdentity(agentA);
        assertEq(id.registrationId, regId);
    }

    function test_Register_Linked_Reverts_NotOperator() public {
        vm.prank(dev);
        uint256 regId = agentReg.registerAgent("BotA", "limited", 1 ether, address(0));

        vm.prank(dev2);
        vm.expectRevert("AgentIdentityRegistry: caller is not registration operator");
        registry.registerAgentIdentity(
            agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, regId
        );
    }

    function test_Register_Linked_Reverts_RevokedRegistration() public {
        vm.prank(dev);
        uint256 regId = agentReg.registerAgent("BotA", "limited", 1 ether, address(0));

        vm.prank(dev);
        agentReg.revokeAgent(regId);

        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: linked registration is revoked");
        registry.registerAgentIdentity(
            agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, regId
        );
    }

    function test_Register_Linked_Reverts_NoAgentRegistrationLinked() public {
        AgentIdentityRegistry standaloneRegistry = new AgentIdentityRegistry(address(0));

        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: no AgentRegistration linked");
        standaloneRegistry.registerAgentIdentity(
            agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.LIMITED, 1
        );
    }

    // ─────────────────────────────────────────────
    // updateCapabilities
    // ─────────────────────────────────────────────

    function test_UpdateCapabilities_Success() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        registry.updateCapabilities(agentA, CAP_HASH2);
        vm.stopPrank();

        assertEq(registry.getCapabilitiesHash(agentA), CAP_HASH2);
    }

    function test_UpdateCapabilities_EmitsEvent() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.expectEmit(true, true, false, true);
        emit CapabilitiesUpdated(agentA, CAP_HASH2, CAP_HASH, block.timestamp);

        registry.updateCapabilities(agentA, CAP_HASH2);
        vm.stopPrank();
    }

    function test_UpdateCapabilities_UpdatesTimestamp() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.warp(block.timestamp + 100);
        registry.updateCapabilities(agentA, CAP_HASH2);
        vm.stopPrank();

        AgentIdentityRegistry.AgentIdentity memory id = registry.getAgentIdentity(agentA);
        assertEq(id.updatedAt, block.timestamp);
    }

    function test_UpdateCapabilities_Reverts_NotDeveloper() public {
        vm.prank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.prank(dev2);
        vm.expectRevert("AgentIdentityRegistry: not developer");
        registry.updateCapabilities(agentA, CAP_HASH2);
    }

    function test_UpdateCapabilities_Reverts_NotRegistered() public {
        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: not registered");
        registry.updateCapabilities(agentA, CAP_HASH2);
    }

    function test_UpdateCapabilities_Reverts_EmptyHash() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.expectRevert("AgentIdentityRegistry: empty capabilitiesHash");
        registry.updateCapabilities(agentA, bytes32(0));
        vm.stopPrank();
    }

    function test_UpdateCapabilities_Reverts_Unchanged() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.expectRevert("AgentIdentityRegistry: capabilities unchanged");
        registry.updateCapabilities(agentA, CAP_HASH);
        vm.stopPrank();
    }

    function test_UpdateCapabilities_Reverts_AfterRevoke() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        registry.revokeIdentity(agentA);

        vm.expectRevert("AgentIdentityRegistry: identity revoked");
        registry.updateCapabilities(agentA, CAP_HASH2);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────
    // revokeIdentity
    // ─────────────────────────────────────────────

    function test_RevokeIdentity_Success() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        registry.revokeIdentity(agentA);
        vm.stopPrank();

        assertFalse(registry.isActive(agentA));
        assertTrue(registry.isIdentityRegistered(agentA)); // record preserved
    }

    function test_RevokeIdentity_EmitsEvent() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.expectEmit(true, true, false, true);
        emit AgentIdentityRevoked(agentA, dev, block.timestamp);

        registry.revokeIdentity(agentA);
        vm.stopPrank();
    }

    function test_RevokeIdentity_Reverts_NotDeveloper() public {
        vm.prank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        vm.prank(dev2);
        vm.expectRevert("AgentIdentityRegistry: not developer");
        registry.revokeIdentity(agentA);
    }

    function test_RevokeIdentity_Reverts_NotRegistered() public {
        vm.prank(dev);
        vm.expectRevert("AgentIdentityRegistry: not registered");
        registry.revokeIdentity(agentA);
    }

    function test_RevokeIdentity_Reverts_AlreadyRevoked() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        registry.revokeIdentity(agentA);

        vm.expectRevert("AgentIdentityRegistry: already revoked");
        registry.revokeIdentity(agentA);
        vm.stopPrank();
    }

    function test_RevokeIdentity_PreservesRecord() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        registry.revokeIdentity(agentA);
        vm.stopPrank();

        // getAgentIdentity still works (record preserved)
        AgentIdentityRegistry.AgentIdentity memory id = registry.getAgentIdentity(agentA);
        assertEq(id.name, "BotA");
        assertFalse(id.active);
    }

    function test_RevokeIdentity_CannotReRegister() public {
        vm.startPrank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        registry.revokeIdentity(agentA);

        vm.expectRevert("AgentIdentityRegistry: already registered");
        registry.registerAgentIdentity(agentA, "BotA", "2.0.0", CAP_HASH2,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────
    // Read functions
    // ─────────────────────────────────────────────

    function test_GetCapabilitiesHash() public {
        vm.prank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.MINIMAL, 0);

        assertEq(registry.getCapabilitiesHash(agentA), CAP_HASH);
    }

    function test_GetComplianceLevel() public {
        vm.prank(dev);
        registry.registerAgentIdentity(agentA, "BotA", "1.0.0", CAP_HASH,
            AgentIdentityRegistry.ComplianceLevel.CRITICAL, 0);

        assertEq(
            uint(registry.getComplianceLevel(agentA)),
            uint(AgentIdentityRegistry.ComplianceLevel.CRITICAL)
        );
    }

    function test_IsActive_FalseForUnregistered() public view {
        assertFalse(registry.isActive(agentA));
    }

    function test_IsIdentityRegistered_FalseForUnregistered() public view {
        assertFalse(registry.isIdentityRegistered(agentA));
    }

    function test_GetAgentIdentity_Reverts_NotRegistered() public {
        vm.expectRevert("AgentIdentityRegistry: not registered");
        registry.getAgentIdentity(agentA);
    }

    function test_GetCapabilitiesHash_Reverts_NotRegistered() public {
        vm.expectRevert("AgentIdentityRegistry: not registered");
        registry.getCapabilitiesHash(agentA);
    }

    function test_GetComplianceLevel_Reverts_NotRegistered() public {
        vm.expectRevert("AgentIdentityRegistry: not registered");
        registry.getComplianceLevel(agentA);
    }
}
