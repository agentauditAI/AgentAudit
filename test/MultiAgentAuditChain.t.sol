// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/MultiAgentAuditChain.sol";

contract MultiAgentAuditChainTest is Test {
    MultiAgentAuditChain public maac;

    bytes32 constant CHAIN_ID = keccak256("chain-001");
    bytes32 constant AGENT_1 = keccak256("agent-001");
    bytes32 constant AGENT_2 = keccak256("agent-002");
    bytes32 constant DATA_HASH = keccak256("data");

    function setUp() public {
        maac = new MultiAgentAuditChain();
    }

    function test_CreateChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        (bytes32 cId,,,, bool finalized) = maac.chains(CHAIN_ID);
        assertEq(cId, CHAIN_ID);
        assertFalse(finalized);
    }

    function test_CreateChain_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit MultiAgentAuditChain.ChainCreated(CHAIN_ID, AGENT_1, block.timestamp);
        maac.createChain(CHAIN_ID, AGENT_1);
    }

    function test_RevertIf_InvalidChainId() public {
        vm.expectRevert("Invalid chainId");
        maac.createChain(bytes32(0), AGENT_1);
    }

    function test_RevertIf_DuplicateChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        vm.expectRevert("Chain already exists");
        maac.createChain(CHAIN_ID, AGENT_1);
    }

    function test_AddEntry() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        uint256 id = maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "classify");
        assertEq(id, 1);
        assertEq(maac.entryCount(), 1);
    }

    function test_AddEntry_EmitsEvent() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        vm.expectEmit(true, true, false, true);
        emit MultiAgentAuditChain.EntryAdded(1, CHAIN_ID, AGENT_1, 1);
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "classify");
    }

    function test_RevertIf_AddToNonExistentChain() public {
        vm.expectRevert("Chain not found");
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "classify");
    }

    function test_MultipleAgentsInChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "step1");
        maac.addEntry(CHAIN_ID, AGENT_2, DATA_HASH, "step2");
        assertEq(maac.getChainEntries(CHAIN_ID).length, 2);
    }

    function test_SequenceNumbers() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "step1");
        maac.addEntry(CHAIN_ID, AGENT_2, DATA_HASH, "step2");
        assertEq(maac.getEntry(1).sequenceNum, 1);
        assertEq(maac.getEntry(2).sequenceNum, 2);
    }

    function test_FinalizeChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.finalizeChain(CHAIN_ID);
        (,,,, bool finalized) = maac.chains(CHAIN_ID);
        assertTrue(finalized);
    }

    function test_RevertIf_AddToFinalizedChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.finalizeChain(CHAIN_ID);
        vm.expectRevert("Chain finalized");
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "step");
    }

    function test_RevertIf_DoubleFinalizeChain() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.finalizeChain(CHAIN_ID);
        vm.expectRevert("Already finalized");
        maac.finalizeChain(CHAIN_ID);
    }

    function test_VerifyChainIntegrity_Empty() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        assertTrue(maac.verifyChainIntegrity(CHAIN_ID));
    }

    function test_VerifyChainIntegrity_Valid() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "step1");
        maac.addEntry(CHAIN_ID, AGENT_2, DATA_HASH, "step2");
        assertTrue(maac.verifyChainIntegrity(CHAIN_ID));
    }

    function test_PrevHashLinked() public {
        maac.createChain(CHAIN_ID, AGENT_1);
        maac.addEntry(CHAIN_ID, AGENT_1, DATA_HASH, "step1");
        maac.addEntry(CHAIN_ID, AGENT_2, DATA_HASH, "step2");
        MultiAgentAuditChain.ChainEntry memory e1 = maac.getEntry(1);
        MultiAgentAuditChain.ChainEntry memory e2 = maac.getEntry(2);
        assertEq(e1.prevEntryHash, bytes32(0));
        assertTrue(e2.prevEntryHash != bytes32(0));
    }
}
