// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AIBOMRegistry.sol";

contract AIBOMRegistryTest is Test {
    AIBOMRegistry public registry;
    address public owner;
    address public user1;
    address public user2;

    bytes32 constant AGENT_ID = keccak256("agent-001");
    string constant CID = "ipfs://QmTest123";
    string constant MODEL = "claude-3-opus";
    string constant VERSION = "1.0.0";
    string constant DATASET = "sha256:abc123";

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        registry = new AIBOMRegistry();
    }

    // ── Register ──────────────────────────────────────────────────────────────

    function test_RegisterAIBOM() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        AIBOMRegistry.AIBOM memory b = registry.getAIBOM(AGENT_ID);
        assertEq(b.cycloneDXHash, CID);
        assertEq(b.modelName, MODEL);
        assertTrue(b.active);
    }

    function test_RegisterAIBOM_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit AIBOMRegistry.AIBOMRegistered(AGENT_ID, CID, address(this), block.timestamp);
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
    }

    function test_RevertIf_DuplicateRegister() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        vm.expectRevert("AIBOM already registered");
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
    }

    function test_RevertIf_EmptyAgentId() public {
        vm.expectRevert("Invalid agentId");
        registry.registerAIBOM(bytes32(0), CID, MODEL, VERSION, DATASET);
    }

    function test_RevertIf_EmptyCycloneDXHash() public {
        vm.expectRevert("CycloneDX hash required");
        registry.registerAIBOM(AGENT_ID, "", MODEL, VERSION, DATASET);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    function test_UpdateAIBOM() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        string memory newCID = "ipfs://QmNewHash456";
        registry.updateAIBOM(AGENT_ID, newCID);
        AIBOMRegistry.AIBOM memory b = registry.getAIBOM(AGENT_ID);
        assertEq(b.cycloneDXHash, newCID);
    }

    function test_UpdateAIBOM_EmitsEvent() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        string memory newCID = "ipfs://QmNewHash456";
        vm.expectEmit(true, false, false, true);
        emit AIBOMRegistry.AIBOMUpdated(AGENT_ID, newCID, block.timestamp);
        registry.updateAIBOM(AGENT_ID, newCID);
    }

    function test_RevertIf_UnauthorizedUpdate() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        vm.prank(user2);
        vm.expectRevert("Not authorized");
        registry.updateAIBOM(AGENT_ID, "ipfs://hacker");
    }

    function test_OwnerCanUpdate() public {
        vm.prank(user1);
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        // owner can update even if not registeredBy
        registry.updateAIBOM(AGENT_ID, "ipfs://QmOwnerUpdate");
        assertEq(registry.getAIBOM(AGENT_ID).cycloneDXHash, "ipfs://QmOwnerUpdate");
    }

    // ── Deactivate ────────────────────────────────────────────────────────────

    function test_DeactivateAIBOM() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        registry.deactivateAIBOM(AGENT_ID);
        assertFalse(registry.getAIBOM(AGENT_ID).active);
    }

    function test_RevertIf_UnauthorizedDeactivate() public {
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        vm.prank(user2);
        vm.expectRevert("Not authorized");
        registry.deactivateAIBOM(AGENT_ID);
    }

    function test_RevertIf_DeactivateNonExistent() public {
        vm.expectRevert("AIBOM not found");
        registry.deactivateAIBOM(AGENT_ID);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    function test_GetRegisteredAgentsCount() public {
        assertEq(registry.getRegisteredAgentsCount(), 0);
        registry.registerAIBOM(AGENT_ID, CID, MODEL, VERSION, DATASET);
        assertEq(registry.getRegisteredAgentsCount(), 1);
        bytes32 agent2 = keccak256("agent-002");
        registry.registerAIBOM(agent2, CID, MODEL, VERSION, DATASET);
        assertEq(registry.getRegisteredAgentsCount(), 2);
    }
}
