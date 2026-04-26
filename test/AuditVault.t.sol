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
    event RiskScoreAssigned(
        address              indexed agentId,
        uint256              indexed batchIndex,
        AuditVault.RiskLevel indexed level,
        string  actionType,
        uint256 spendValue,
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
    // Helpers
    // ─────────────────────────────────────────────

    function _commitBatch(
        address agent, bytes32 root, string memory uri,
        uint256 count, uint8 score, string memory action, uint256 spend
    ) internal {
        vault.commitBatch(agent, root, uri, count, score, action, spend);
    }

    function _commitChildBatch(
        address agent, bytes32 root, string memory uri,
        uint256 count, uint8 score, string memory action, uint256 spend,
        address parent, uint256 parentIdx
    ) internal {
        vault.commitChildBatch(agent, root, uri, count, score, action, spend, parent, parentIdx);
    }

    // ─────────────────────────────────────────────
    // Registration
    // ─────────────────────────────────────────────

    function test_RegisterAgent() public {
        vault.registerAgent(agentA, "DeFi", "ElizaOS", "Mantle");
        AuditVault.AgentInfo memory info = vault.getAgentInfo(agentA);
        assertTrue(info.registered);
        assertEq(info.agentType, "DeFi");
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
    // commitBatch — base behaviour
    // ─────────────────────────────────────────────

    function test_CommitBatch_StoresFields() public {
        vm.prank(submitter);
        _commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 85, "LOG", 0);

        AuditVault.LogBatch memory b = vault.getBatch(agentA, 0);
        assertEq(b.merkleRoot, ROOT1);
        assertEq(b.contentURI, "ipfs://cid1");
        assertEq(b.eventCount, 10);
        assertEq(b.complianceScore, 85);
        assertEq(b.submitter, submitter);
        assertFalse(b.hasParent);
        assertEq(b.parentAgentId, address(0));
    }

    function test_CommitBatch_CountsUpdated() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 10, 85, "LOG", 0);
        _commitBatch(agentA, ROOT2, "ipfs://2",  5, 90, "LOG", 0);
        assertEq(vault.getBatchCount(agentA), 2);
        assertEq(vault.agentEventCount(agentA), 15);
        assertEq(vault.totalBatches(), 2);
    }

    function test_CommitBatch_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LogBatchCommitted(agentA, 0, ROOT1, "ipfs://cid1", 10, 85, block.timestamp);
        _commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 85, "LOG", 0);
    }

    function test_CommitBatch_EmptyMerkleRootReverts() public {
        vm.expectRevert("AuditVault: empty merkle root");
        vault.commitBatch(agentA, bytes32(0), "ipfs://cid1", 10, 85, "LOG", 0);
    }

    function test_CommitBatch_EmptyURIReverts() public {
        vm.expectRevert("AuditVault: empty contentURI");
        vault.commitBatch(agentA, ROOT1, "", 10, 85, "LOG", 0);
    }

    function test_CommitBatch_ZeroEventCountReverts() public {
        vm.expectRevert("AuditVault: zero event count");
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 0, 85, "LOG", 0);
    }

    function test_CommitBatch_ScoreOver100Reverts() public {
        vm.expectRevert("AuditVault: score exceeds 100");
        vault.commitBatch(agentA, ROOT1, "ipfs://cid1", 10, 101, "LOG", 0);
    }

    // ─────────────────────────────────────────────
    // Risk Scoring — _computeRisk logic
    // ─────────────────────────────────────────────

    function test_Risk_LOW_DefaultAction() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LOG", 0);
        AuditVault.LogBatch memory b = vault.getBatch(agentA, 0);
        assertEq(uint8(b.riskLevel), uint8(AuditVault.RiskLevel.LOW));
    }

    function test_Risk_MEDIUM_ByAction_SWAP() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "SWAP", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_ByAction_APPROVE() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "APPROVE", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_ByAction_DELEGATE() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "DELEGATE", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_ByAction_STAKE() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "STAKE", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_ByAction_BORROW() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "BORROW", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_BySpend() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LOG", 2 ether);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_MEDIUM_SpendAtExactThreshold() public {
        // > 1 ether = MEDIUM; exactly 1 ether = LOW
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LOG", 1 ether);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.LOW));
    }

    function test_Risk_HIGH_ByAction_TRANSFER() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "TRANSFER", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_ByAction_WITHDRAW() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "WITHDRAW", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_ByAction_LIQUIDATE() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LIQUIDATE", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_ByAction_BRIDGE() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "BRIDGE", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_ByAction_DRAIN() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "DRAIN", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_BySpend() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LOG", 11 ether);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    function test_Risk_HIGH_SpendAtExactHighThreshold() public {
        // exactly 10 ether is NOT > RISK_THRESHOLD_HIGH, but IS > RISK_THRESHOLD_MEDIUM → MEDIUM
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "LOG", 10 ether);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.MEDIUM));
    }

    function test_Risk_ActionTakesPrecedenceOverSpend() public {
        // TRANSFER is HIGH even with zero spend
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "TRANSFER", 0);
        assertEq(uint8(vault.getBatch(agentA, 0).riskLevel), uint8(AuditVault.RiskLevel.HIGH));
    }

    // ─────────────────────────────────────────────
    // RiskScoreAssigned event
    // ─────────────────────────────────────────────

    function test_RiskScoreAssigned_EmittedOnCommitBatch() public {
        vm.expectEmit(true, true, true, true);
        emit RiskScoreAssigned(agentA, 0, AuditVault.RiskLevel.HIGH, "TRANSFER", 0, block.timestamp);
        _commitBatch(agentA, ROOT1, "ipfs://1", 1, 90, "TRANSFER", 0);
    }

    function test_RiskScoreAssigned_EmittedOnChildBatch() public {
        _commitBatch(agentA, ROOT1, "ipfs://parent", 1, 90, "LOG", 0);

        vm.expectEmit(true, true, true, true);
        emit RiskScoreAssigned(agentB, 0, AuditVault.RiskLevel.MEDIUM, "SWAP", 0, block.timestamp);
        _commitChildBatch(agentB, ROOT2, "ipfs://child", 1, 80, "SWAP", 0, agentA, 0);
    }

    // ─────────────────────────────────────────────
    // getRiskScore
    // ─────────────────────────────────────────────

    function test_GetRiskScore_StoredCorrectly() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 5, 90, "BRIDGE", 3 ether);
        AuditVault.RiskScore memory rs = vault.getRiskScore(agentA, 0);
        assertEq(uint8(rs.level), uint8(AuditVault.RiskLevel.HIGH));
        assertEq(rs.actionType, "BRIDGE");
        assertEq(rs.spendValue, 3 ether);
    }

    function test_GetRiskScore_InvalidBatchReverts() public {
        vm.expectRevert("AuditVault: batch not found");
        vault.getRiskScore(agentA, 0);
    }

    // ─────────────────────────────────────────────
    // commitChildBatch — risk scoring
    // ─────────────────────────────────────────────

    function test_CommitChildBatch_RiskScored() public {
        _commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90, "LOG", 0);
        _commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, "WITHDRAW", 0, agentA, 0);

        AuditVault.LogBatch memory child = vault.getBatch(agentB, 0);
        assertEq(uint8(child.riskLevel), uint8(AuditVault.RiskLevel.HIGH));
        assertTrue(child.hasParent);
    }

    function test_CommitChildBatch_ParentNotFoundReverts() public {
        vm.expectRevert("AuditVault: parent batch not found");
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, "LOG", 0, agentA, 0);
    }

    function test_CommitChildBatch_ZeroParentAgentReverts() public {
        vm.expectRevert("AuditVault: zero parent agent");
        vault.commitChildBatch(agentB, ROOT2, "ipfs://child", 3, 80, "LOG", 0, address(0), 0);
    }

    // ─────────────────────────────────────────────
    // commitHighRiskEvent — always HIGH
    // ─────────────────────────────────────────────

    function test_CommitHighRiskEvent_AlwaysHigh() public {
        vault.commitHighRiskEvent(agentA, ROOT1, "ipfs://highrisk");
        AuditVault.LogBatch memory b = vault.getBatch(agentA, 0);
        assertEq(uint8(b.riskLevel), uint8(AuditVault.RiskLevel.HIGH));
        assertEq(b.complianceScore, 0);
        assertFalse(b.hasParent);
    }

    function test_CommitHighRiskEvent_RiskScoreStored() public {
        vault.commitHighRiskEvent(agentA, ROOT1, "ipfs://highrisk");
        AuditVault.RiskScore memory rs = vault.getRiskScore(agentA, 0);
        assertEq(uint8(rs.level), uint8(AuditVault.RiskLevel.HIGH));
        assertEq(rs.actionType, "HIGH_RISK_EVENT");
        assertEq(rs.spendValue, 0);
    }

    function test_CommitHighRiskEvent_EmptyRootReverts() public {
        vm.expectRevert("AuditVault: empty merkle root");
        vault.commitHighRiskEvent(agentA, bytes32(0), "ipfs://highrisk");
    }

    // ─────────────────────────────────────────────
    // getChildBatches
    // ─────────────────────────────────────────────

    function test_GetChildBatches_Empty() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 5, 90, "LOG", 0);
        assertEq(vault.getChildBatches(agentA, 0).length, 0);
    }

    function test_GetChildBatches_MultipleChildren() public {
        _commitBatch(agentA, ROOT1, "ipfs://parent", 5, 90, "LOG", 0);
        _commitChildBatch(agentB, ROOT2, "ipfs://b", 3, 80, "LOG", 0, agentA, 0);
        _commitChildBatch(agentC, ROOT3, "ipfs://c", 7, 75, "LOG", 0, agentA, 0);

        AuditVault.BatchRef[] memory children = vault.getChildBatches(agentA, 0);
        assertEq(children.length, 2);
        assertEq(children[0].agentId, agentB);
        assertEq(children[1].agentId, agentC);
    }

    // ─────────────────────────────────────────────
    // getAncestorChain
    // ─────────────────────────────────────────────

    function test_GetAncestorChain_RootReturnsEmpty() public {
        _commitBatch(agentA, ROOT1, "ipfs://root", 5, 90, "LOG", 0);
        assertEq(vault.getAncestorChain(agentA, 0).length, 0);
    }

    function test_GetAncestorChain_ThreeLevels() public {
        // A[0] <- B[0] <- C[0]
        _commitBatch(agentA, ROOT1, "ipfs://root", 5, 90, "LOG", 0);
        _commitChildBatch(agentB, ROOT2, "ipfs://mid",  3, 80, "LOG", 0, agentA, 0);
        _commitChildBatch(agentC, ROOT3, "ipfs://leaf", 2, 70, "LOG", 0, agentB, 0);

        AuditVault.BatchRef[] memory chain = vault.getAncestorChain(agentC, 0);
        assertEq(chain.length, 2);
        assertEq(chain[0].agentId, agentB); // immediate parent
        assertEq(chain[1].agentId, agentA); // grandparent
    }

    // ─────────────────────────────────────────────
    // Merkle verification
    // ─────────────────────────────────────────────

    function test_VerifyLog_ValidProof() public {
        bytes32 leaf0 = keccak256("log-entry-0");
        bytes32 leaf1 = keccak256("log-entry-1");
        bytes32 root  = leaf0 <= leaf1
            ? keccak256(abi.encodePacked(leaf0, leaf1))
            : keccak256(abi.encodePacked(leaf1, leaf0));

        _commitBatch(agentA, root, "ipfs://cid", 2, 90, "LOG", 0);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;
        assertTrue(vault.verifyLog(agentA, 0, leaf0, proof));
    }

    function test_VerifyLog_InvalidProof() public {
        bytes32 leaf0 = keccak256("log-entry-0");
        bytes32 leaf1 = keccak256("log-entry-1");
        bytes32 root  = leaf0 <= leaf1
            ? keccak256(abi.encodePacked(leaf0, leaf1))
            : keccak256(abi.encodePacked(leaf1, leaf0));

        _commitBatch(agentA, root, "ipfs://cid", 2, 90, "LOG", 0);

        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("wrong");
        assertFalse(vault.verifyLog(agentA, 0, leaf0, badProof));
    }

    // ─────────────────────────────────────────────
    // Misc read functions
    // ─────────────────────────────────────────────

    function test_GetLatestComplianceScore() public {
        _commitBatch(agentA, ROOT1, "ipfs://1", 5, 90, "LOG", 0);
        _commitBatch(agentA, ROOT2, "ipfs://2", 3, 70, "LOG", 0);
        assertEq(vault.getLatestComplianceScore(agentA), 70);
    }

    function test_GetLatestComplianceScore_NoBatchesReverts() public {
        vm.expectRevert("AuditVault: no batches for agent");
        vault.getLatestComplianceScore(agentA);
    }
}
