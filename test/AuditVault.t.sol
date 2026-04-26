// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/AuditVault.sol";

contract AuditVaultTest is Test {

    // Redeclared for vm.expectEmit (Solidity 0.8.20 doesn't support emit Contract.Event syntax)
    event LogBatchCommitted(
        address indexed agentId,
        uint256 indexed batchIndex,
        bytes32 merkleRoot,
        string  contentURI,
        uint256 eventCount,
        uint8   complianceScore,
        uint256 timestamp
    );
    event ChildBatchCommitted(
        address indexed agentId,
        uint256 indexed batchIndex,
        address indexed parentAgentId,
        uint256 parentBatchIndex,
        bytes32 merkleRoot,
        string  contentURI,
        uint256 eventCount,
        uint8   complianceScore,
        uint256 timestamp
    );
    AuditVault public vault;

    address public agentA = address(0x1111);
    address public agentB = address(0x2222);
    address public agentC = address(0x3333);
    address public submitter = address(0x9999);

    bytes32 constant ROOT1 = keccak256("root1");
    bytes32 constant ROOT2 = keccak256("root2");
    bytes32 constant ROOT3 = keccak256("root3");

    function setUp() public {
        vault = new AuditVault();
    }

    // ─────────────────────────────────────────────
    // Registration
    // ─────────────────────────────────────────────

    function test_RegisterAgent() public {
        vault.registerAgent(agentA, "DeFi", "ElizaOS", "Mantle");
        AuditVault.AgentInfo memory info = vault.getAgentInfo(agentA);

        assertTrue(info.registered);
        assertEq(info.agentType, "DeFi");
        assertEq(info.framework, "ElizaOS");
        assertEq(info.network, "Mantle");
    }

    function test_CannotRegisterTwice() public {
        vault.registerAgent(agentA, "DeFi", "ElizaOS", "Mantle");
        vm.expectRevert("AuditVault: agent already registered");
        vault.registerAgent(agentA, "DeFi", "ElizaOS", "Mantle");
    }

    function test_IsRegistered() public {
        assertFalse(vault.isRegistered(agentA));
        vault.registerAgent(agentA, "DeFi", "ElizaOS", "Mantle");
        assertTrue(vault.isRegistered(agentA));
    }

    // ─────────────────────────────────────────────
    // commitBatch (root)
    // ─────────────────────────────────────────────

    function test_CommitBatch() public {
        vm.prank(submitter);
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 85);

        AuditVault.LogBatch memory b = vault.getBatch(agentA, 0);
        assertEq(b.merkleRoot, ROOT1);
        assertEq(b.contentURI, "ipfs://cid1");
        assertEq(b.eventCount, 10);
        assertEq(b.complianceScore, 85);
        assertEq(b.submitter, submitter);
        assertFalse(b.hasParent);
        assertEq(b.parentAgentId, address(0));
        assertEq(b.parentBatchIndex, 0);
    }

    function test_CommitBatch_CountsUpdated() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 85);
        vault.commitBatch(agentA, ROOT2, "ipfs://cid2", 5, 90);

        assertEq(vault.getBatchCount(agentA), 2);
        assertEq(vault.agentEventCount(agentA), 15);
        assertEq(vault.totalBatches(), 2);
    }

    function test_CommitBatch_EmptyMerkleRootReverts() public {
        vm.expectRevert("AuditVault: empty merkle root");
        vault.commitBatch(agentA, bytes32(0), "ipfs://cid1", 10, 85);
    }

    function test_CommitBatch_EmptyURIReverts() public {
        vm.expectRevert("AuditVault: empty contentURI");
        vault.commitBatch(agentA, ROOT1, "", 10, 85);
    }

    function test_CommitBatch_ZeroEventCountReverts() public {
        vm.expectRevert("AuditVault: zero event count");
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 0, 85);
    }

    function test_CommitBatch_ScoreOver100Reverts() public {
        vm.expectRevert("AuditVault: score exceeds 100");
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 101);
    }

    function test_CommitBatch_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LogBatchCommitted(agentA, 0, ROOT1, "ipfs://cid1", 10, 85, block.timestamp);
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 85);
    }

    // ─────────────────────────────────────────────
    // commitChildBatch
    // ─────────────────────────────────────────────

    function test_CommitChildBatch_Basic() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);

        vm.prank(submitter);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);

        AuditVault.LogBatch memory child = vault.getBatch(agentB, 0);
        assertTrue(child.hasParent);
        assertEq(child.parentAgentId, agentA);
        assertEq(child.parentBatchIndex, 0);
        assertEq(child.merkleRoot, ROOT2);
        assertEq(child.submitter, submitter);
    }

    function test_CommitChildBatch_ParentNotFoundReverts() public {
        vm.expectRevert("AuditVault: parent batch not found");
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);
    }

    function test_CommitChildBatch_ZeroParentAgentReverts() public {
        vm.expectRevert("AuditVault: zero parent agent");
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, address(0), 0);
    }

    function test_CommitChildBatch_WrongParentIndexReverts() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);

        vm.expectRevert("AuditVault: parent batch not found");
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 99);
    }

    function test_CommitChildBatch_EmitsEvent() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);

        vm.expectEmit(true, true, true, true);
        emit ChildBatchCommitted(
            agentB, 0, agentA, 0, ROOT2, "ipfs://child", 3, 80, block.timestamp
        );
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);
    }

    function test_CommitChildBatch_CountsUpdated() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);

        assertEq(vault.totalBatches(), 2);
        assertEq(vault.agentEventCount(agentB), 3);
    }

    // ─────────────────────────────────────────────
    // getChildBatches
    // ─────────────────────────────────────────────

    function test_GetChildBatches_Empty() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);
        AuditVault.BatchRef[] memory children = vault.getChildBatches(agentA, 0);
        assertEq(children.length, 0);
    }

    function test_GetChildBatches_OneChild() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);

        AuditVault.BatchRef[] memory children = vault.getChildBatches(agentA, 0);
        assertEq(children.length, 1);
        assertEq(children[0].agentId, agentB);
        assertEq(children[0].batchIndex, 0);
    }

    function test_GetChildBatches_MultipleChildren() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://childB", 3, 80, agentA, 0);
        vault.commitChildBatch(agentC, ROOT3, "ipfs://childC", 7, 75, agentA, 0);

        AuditVault.BatchRef[] memory children = vault.getChildBatches(agentA, 0);
        assertEq(children.length, 2);
        assertEq(children[0].agentId, agentB);
        assertEq(children[1].agentId, agentC);
    }

    function test_GetChildBatches_InvalidParentReverts() public {
        vm.expectRevert("AuditVault: parent batch not found");
        vault.getChildBatches(agentA, 0);
    }

    // ─────────────────────────────────────────────
    // getAncestorChain
    // ─────────────────────────────────────────────

    function test_GetAncestorChain_RootReturnsEmpty() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://root", 5, 90);
        AuditVault.BatchRef[] memory chain = vault.getAncestorChain(agentA, 0);
        assertEq(chain.length, 0);
    }

    function test_GetAncestorChain_OneLevel() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://root", 5, 90);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, agentA, 0);

        AuditVault.BatchRef[] memory chain = vault.getAncestorChain(agentB, 0);
        assertEq(chain.length, 1);
        assertEq(chain[0].agentId, agentA);
        assertEq(chain[0].batchIndex, 0);
    }

    function test_GetAncestorChain_ThreeLevels() public {
        // A[0] <- B[0] <- C[0]
        vault.commitBatch(agentA, ROOT1, "ipfs://root", 5, 90);
        vault.commitChildBatch(agentB, ROOT2, "ipfs://mid", 3, 80, agentA, 0);
        vault.commitChildBatch(agentC, ROOT3, "ipfs://leaf", 2, 70, agentB, 0);

        AuditVault.BatchRef[] memory chain = vault.getAncestorChain(agentC, 0);
        assertEq(chain.length, 2);
        // immediate parent first
        assertEq(chain[0].agentId, agentB);
        assertEq(chain[0].batchIndex, 0);
        // grandparent second
        assertEq(chain[1].agentId, agentA);
        assertEq(chain[1].batchIndex, 0);
    }

    function test_GetAncestorChain_SameAgentChain() public {
        // agentA[0] <- agentA[1] (self-reference chain)
        vault.commitBatch(agentA, ROOT1, "ipfs://root", 5, 90);
        vault.commitChildBatch(agentA, ROOT2, "ipfs://child", 3, 80, agentA, 0);

        AuditVault.BatchRef[] memory chain = vault.getAncestorChain(agentA, 1);
        assertEq(chain.length, 1);
        assertEq(chain[0].agentId, agentA);
        assertEq(chain[0].batchIndex, 0);
    }

    // ─────────────────────────────────────────────
    // High-risk event
    // ─────────────────────────────────────────────

    function test_CommitHighRiskEvent() public {
        vault.commitHighRiskEvent(agentA, ROOT1, "ipfs://highrisk");

        AuditVault.LogBatch memory b = vault.getBatch(agentA, 0);
        assertEq(b.merkleRoot, ROOT1);
        assertEq(b.eventCount, 1);
        assertEq(b.complianceScore, 0);
        assertFalse(b.hasParent);
    }

    function test_CommitHighRiskEvent_EmptyRootReverts() public {
        vm.expectRevert("AuditVault: empty merkle root");
        vault.commitHighRiskEvent(agentA, bytes32(0), "ipfs://highrisk");
    }

    // ─────────────────────────────────────────────
    // Merkle verification
    // ─────────────────────────────────────────────

    function test_VerifyLog_ValidProof() public {
        // Build a 2-leaf Merkle tree: leaves = [leaf0, leaf1]
        bytes32 leaf0 = keccak256("log-entry-0");
        bytes32 leaf1 = keccak256("log-entry-1");
        bytes32 root;
        if (leaf0 <= leaf1) {
            root = keccak256(abi.encodePacked(leaf0, leaf1));
        } else {
            root = keccak256(abi.encodePacked(leaf1, leaf0));
        }

        vault.commitBatch(agentA, root, "ipfs://cid", 2, 90);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;
        assertTrue(vault.verifyLog(agentA, 0, leaf0, proof));
    }

    function test_VerifyLog_InvalidProof() public {
        bytes32 leaf0 = keccak256("log-entry-0");
        bytes32 leaf1 = keccak256("log-entry-1");
        bytes32 root;
        if (leaf0 <= leaf1) {
            root = keccak256(abi.encodePacked(leaf0, leaf1));
        } else {
            root = keccak256(abi.encodePacked(leaf1, leaf0));
        }

        vault.commitBatch(agentA, root, "ipfs://cid", 2, 90);

        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("wrong");
        assertFalse(vault.verifyLog(agentA, 0, leaf0, badProof));
    }

    // ─────────────────────────────────────────────
    // Misc read functions
    // ─────────────────────────────────────────────

    function test_GetAllBatches() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://1", 5, 90);
        vault.commitBatch(agentA, ROOT2, "ipfs://2", 3, 80);

        AuditVault.LogBatch[] memory all = vault.getAllBatches(agentA);
        assertEq(all.length, 2);
    }

    function test_GetLatestComplianceScore() public {
        vault.commitBatch(agentA, ROOT1, "ipfs://1", 5, 90);
        vault.commitBatch(agentA, ROOT2, "ipfs://2", 3, 70);
        assertEq(vault.getLatestComplianceScore(agentA), 70);
    }

    function test_GetLatestComplianceScore_NoBatchesReverts() public {
        vm.expectRevert("AuditVault: no batches for agent");
        vault.getLatestComplianceScore(agentA);
    }
}
