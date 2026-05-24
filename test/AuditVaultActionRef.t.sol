// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AuditVault × Nobulex bilateral-receipt action_ref compatibility
/// @notice Tests that nobulex action_ref values (SHA-256 of JCS preimage per RFC 8785)
///         are compatible as Merkle leaves in AuditVault's commitBatch / verifyLog pipeline.
/// @dev Vectors sourced from github.com/nobulexdev/nobulex
///      fixtures/bilateral-receipt/v0/vectors.json (schema v0.1, canon jcs-rfc8785-v1)
///
/// Pipeline under test:
///   1. Off-chain: compute action_ref = sha256(jcs(preimage_fields))  [nobulex]
///   2. Off-chain: build sorted-pair keccak256 Merkle tree of action_refs
///   3. On-chain:  AuditVault.commitBatch(agentAddr, merkleRoot, uri, n, score)
///   4. On-chain:  AuditVault.verifyLog(agentAddr, batchIdx, action_ref, proof)
///
/// Compatibility gaps documented in test_compatibility_notes().

import "forge-std/Test.sol";
import "../contracts/v2/AuditVault.sol";

contract AuditVaultActionRefTest is Test {

    // ─── Actors ───────────────────────────────────────────────────────────────

    AuditVault public vault;
    address submitter = makeAddr("submitter");

    // Ethereum address standing in for string agent-id "nobulex-test-agent".
    // Off-chain registry must maintain the string → address mapping.
    address agent;

    // ─── Fixture: action_ref values from vectors.json ─────────────────────────
    //
    // action_ref = sha256(jcs_canonical_preimage)
    // Keys sorted alphabetically per RFC 8785; no extra whitespace.

    // Vector 0001 — ALLOW, send_email
    string constant PREIMAGE_0001 =
        '{"action_type":"send_email","agent_id":"nobulex-test-agent","scope":"user@example.com","timestamp_ms":1748000000000}';
    bytes32 constant ACTION_REF_0001 =
        0x86bdb19ed2ee90065ca9fbeaf597075ea03abab6ff01027d457239b9c7c5809b;

    // Vector 0002 — DENY, delete_database
    string constant PREIMAGE_0002 =
        '{"action_type":"delete_database","agent_id":"nobulex-test-agent","scope":"production","timestamp_ms":1748000001000}';
    bytes32 constant ACTION_REF_0002 =
        0xae036c69337e09fcaab63d3ebc77e9a1d80a1f019a830815890c43bf1bd79d4f;

    // Vector 0003 — ALLOW + policy_version (envelope-only; does not affect action_ref)
    string constant PREIMAGE_0003 =
        '{"action_type":"transfer_funds","agent_id":"nobulex-test-agent","scope":"100_USDC","timestamp_ms":1748000002000}';
    bytes32 constant ACTION_REF_0003 =
        0xdd0a1ec0afdcdfd4be7eb45404449ecdb7f697b01d707a06a32305fc05fadf75;

    // Vector 0004 — dual-timestamp / revocation test case
    string constant PREIMAGE_0004 =
        '{"action_type":"transfer_funds","agent_id":"nobulex-test-agent","scope":"500_USDC_to_vendor","timestamp_ms":1748000003000}';
    bytes32 constant ACTION_REF_0004 =
        0x57c4990825b8be98f326acf8065a43280f51e2c6727ffd9bdb14c62eff6985da;

    // ─── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        vault = new AuditVault();
        agent = makeAddr("nobulex-test-agent");

        vm.prank(submitter);
        vault.registerAgent(agent, "Guardian", "Nobulex", "Arbitrum");
    }

    // ─── SHA-256 preimage verification ────────────────────────────────────────

    /// @dev AuditVault's Merkle tree accepts any bytes32 as a leaf — the hash
    ///      algorithm used to produce that leaf is irrelevant to the contract.
    ///      These tests confirm the external SHA-256 computation is correct so
    ///      the action_ref values hardcoded in the pipeline match the spec.

    function test_actionRef_sha256_vector0001() public pure {
        bytes32 computed = sha256(bytes(PREIMAGE_0001));
        assertEq(computed, ACTION_REF_0001, "0001: sha256 mismatch");
    }

    function test_actionRef_sha256_vector0002() public pure {
        bytes32 computed = sha256(bytes(PREIMAGE_0002));
        assertEq(computed, ACTION_REF_0002, "0002: sha256 mismatch");
    }

    function test_actionRef_sha256_vector0003() public pure {
        bytes32 computed = sha256(bytes(PREIMAGE_0003));
        assertEq(computed, ACTION_REF_0003, "0003: sha256 mismatch");
    }

    function test_actionRef_sha256_vector0004() public pure {
        bytes32 computed = sha256(bytes(PREIMAGE_0004));
        assertEq(computed, ACTION_REF_0004, "0004: sha256 mismatch");
    }

    // ─── Merkle anchoring ─────────────────────────────────────────────────────

    /// @notice Build a 4-leaf sorted-pair keccak256 Merkle tree from the four
    ///         action_refs and commit it to AuditVault.
    function test_actionRef_anchoring_batchCommit() public {
        (bytes32 root,,) = _buildTree();

        vm.prank(submitter);
        vault.commitBatch(agent, root, "ipfs://nobulex-v0-batch", 4, 95);

        assertEq(vault.getBatchCount(agent), 1);
        AuditVault.LogBatch memory b = vault.getBatch(agent, 0);
        assertEq(b.merkleRoot, root);
        assertEq(b.eventCount, 4);
        assertEq(b.complianceScore, 95);
    }

    /// @notice Each action_ref is individually verifiable against the committed root.
    function test_actionRef_merkleVerify_allLeaves() public {
        (bytes32 root, bytes32 node01, bytes32 node23) = _buildTree();

        vm.prank(submitter);
        vault.commitBatch(agent, root, "ipfs://nobulex-v0-batch", 4, 95);

        // Proof for leaf 0001: sibling = 0002, then uncle = node23
        bytes32[] memory proof0 = new bytes32[](2);
        proof0[0] = ACTION_REF_0002;
        proof0[1] = node23;
        assertTrue(vault.verifyLog(agent, 0, ACTION_REF_0001, proof0), "0001 proof fail");

        // Proof for leaf 0002: sibling = 0001, then uncle = node23
        bytes32[] memory proof1 = new bytes32[](2);
        proof1[0] = ACTION_REF_0001;
        proof1[1] = node23;
        assertTrue(vault.verifyLog(agent, 0, ACTION_REF_0002, proof1), "0002 proof fail");

        // Proof for leaf 0003: sibling = 0004, then uncle = node01
        bytes32[] memory proof2 = new bytes32[](2);
        proof2[0] = ACTION_REF_0004;
        proof2[1] = node01;
        assertTrue(vault.verifyLog(agent, 0, ACTION_REF_0003, proof2), "0003 proof fail");

        // Proof for leaf 0004: sibling = 0003, then uncle = node01
        bytes32[] memory proof3 = new bytes32[](2);
        proof3[0] = ACTION_REF_0003;
        proof3[1] = node01;
        assertTrue(vault.verifyLog(agent, 0, ACTION_REF_0004, proof3), "0004 proof fail");
    }

    /// @notice A DENY verdict (vector 0002) anchors exactly like an ALLOW — verdict
    ///         is envelope-only and does not appear in the action_ref preimage.
    function test_actionRef_deniedReceipt_anchors_independently() public {
        // Single-receipt high-risk batch for the DENY action
        bytes32 denyRef = ACTION_REF_0002;

        vm.prank(submitter);
        vault.commitHighRiskEvent(agent, denyRef, "ipfs://deny-0002");

        AuditVault.LogBatch memory b = vault.getBatch(agent, 0);
        assertEq(b.merkleRoot, denyRef, "DENY action_ref not stored as root");
        assertEq(b.eventCount, 1);
        assertEq(b.complianceScore, 0); // high-risk always 0

        // verifyLog with empty proof: leaf == root for a single-leaf tree
        bytes32[] memory emptyProof = new bytes32[](0);
        assertTrue(vault.verifyLog(agent, 0, denyRef, emptyProof), "single-leaf verify fail");
    }

    /// @notice policy_version (vectors 0003/0004) is envelope-only; two receipts
    ///         issued under different policies but with the same preimage_fields
    ///         would produce the same action_ref — the policy context must be
    ///         preserved in the contentURI / off-chain payload, not on-chain.
    function test_actionRef_policyVersion_not_in_preimage() public pure {
        // Both vectors use "transfer_funds" but different scope+timestamp, so refs differ.
        // This test asserts the negative: adding policy_version to the preimage changes the hash.
        string memory withPolicy =
            '{"action_type":"transfer_funds","agent_id":"nobulex-test-agent","policy_version":"risk-policy-v2.1","scope":"100_USDC","timestamp_ms":1748000002000}';
        bytes32 withPolicyRef = sha256(bytes(withPolicy));
        assertTrue(withPolicyRef != ACTION_REF_0003,
            "policy_version must be envelope-only; preimage must not include it");
    }

    /// @notice Revocation status (vector 0004) is not in the preimage — the action_ref
    ///         is stable even when the issuing authority is later revoked.
    function test_actionRef_revocationStatus_not_in_preimage() public pure {
        // action_ref is computed at issuance; revocation_check_at_ms is post-fact.
        // The on-chain anchor is immutable — revocation is a layer-2 policy concern.
        bytes32 ref = sha256(bytes(PREIMAGE_0004));
        assertEq(ref, ACTION_REF_0004,
            "action_ref must be stable regardless of post-issuance revocation status");
    }

    // ─── Gap documentation (non-reverting assertions) ─────────────────────────

    /// @notice Documents the three structural gaps between the nobulex receipt
    ///         format and AuditVault's native types. None block integration, but
    ///         all require off-chain bookkeeping.
    function test_compatibility_notes() public view {
        // GAP 1: agent_id type — string vs address
        // nobulex uses string "nobulex-test-agent"; AuditVault keys by address.
        // Off-chain registry must maintain the bidirectional mapping.
        assertTrue(agent != address(0), "agent address must be pre-registered");

        // GAP 2: timestamp resolution — ms vs seconds
        // action_ref preimage embeds timestamp_ms (Unix ms).
        // AuditVault batch records block.timestamp (Unix seconds).
        // The ms value is locked inside the action_ref hash — no on-chain field for it.
        // Reconciliation requires the off-chain payload referenced by contentURI.
        uint256 timestampMs0001 = 1748000000000;
        uint256 blockSeconds    = block.timestamp; // forge default: 1
        assertTrue(timestampMs0001 / 1000 != blockSeconds,
            "timestamp units diverge: expected; reconcile via contentURI");

        // GAP 3: hash algorithm layering — SHA-256 leaves, keccak256 nodes
        // Leaves are SHA-256 (action_ref); Merkle nodes are keccak256.
        // AuditVault.verifyLog() is agnostic to leaf algorithm — it trusts
        // whatever bytes32 is passed. The SHA-256 origin must be documented
        // in the contentURI / batch metadata so auditors can re-derive proofs.
        bytes32 leaf = sha256(bytes(PREIMAGE_0001));
        assertEq(leaf, ACTION_REF_0001, "leaf is SHA-256; nodes are keccak256 (hybrid is valid)");
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Build the 4-leaf sorted-pair keccak256 Merkle tree.
    ///      Leaf ordering: [0001, 0002, 0003, 0004]
    ///      Returns (root, node01, node23, _unused).
    function _buildTree() internal pure returns (bytes32 root, bytes32 node01, bytes32 node23) {
        node01 = _hashPair(ACTION_REF_0001, ACTION_REF_0002);
        node23 = _hashPair(ACTION_REF_0003, ACTION_REF_0004);
        root   = _hashPair(node01, node23);
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        if (a <= b) return keccak256(abi.encodePacked(a, b));
        return keccak256(abi.encodePacked(b, a));
    }
}
