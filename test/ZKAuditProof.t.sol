// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/v2/ZKAuditProof.sol";

contract ZKAuditProofTest is Test {

    // Redeclared for vm.expectEmit
    event CommitmentSubmitted(
        uint256 indexed commitmentId,
        address indexed agentId,
        address indexed submitter,
        bytes32         commitment,
        uint256         timestamp
    );
    event ProofVerified(
        uint256 indexed commitmentId,
        address indexed agentId,
        bytes32         inputHash,
        bytes32         policyHash,
        uint256         timestamp
    );
    event ProofFailed(
        uint256 indexed commitmentId,
        address indexed submitter,
        uint256         timestamp
    );

    ZKAuditProof public zkProof;

    address public agent    = address(0x1111);
    address public agent2   = address(0x2222);
    address public alice    = address(0xAAAA);   // submitter
    address public bob      = address(0xBBBB);   // second submitter
    address public stranger = address(0xFFFF);   // not a submitter

    bytes32 constant INPUT_HASH  = keccak256("prompt: swap 1 ETH for USDC, context: portfolio=DeFi");
    bytes32 constant POLICY_HASH = keccak256("eu-ai-act-limited-v2-policy-doc");
    uint256 constant NONCE       = 0xDEADBEEFCAFEBABE;

    bytes32 public validCommitment;   // keccak256(abi.encodePacked(INPUT_HASH, POLICY_HASH, NONCE))

    function setUp() public {
        zkProof = new ZKAuditProof();
        validCommitment = keccak256(abi.encodePacked(INPUT_HASH, POLICY_HASH, NONCE));
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    function _submit(address submitter_, address agentId, bytes32 c)
        internal returns (uint256)
    {
        vm.prank(submitter_);
        return zkProof.submitCommitment(agentId, c);
    }

    function _verify(address submitter_, uint256 id, bytes32 ih, bytes32 ph, uint256 n)
        internal
    {
        vm.prank(submitter_);
        zkProof.verifyProof(id, ih, ph, n);
    }

    // ─────────────────────────────────────────────
    // submitCommitment — success cases
    // ─────────────────────────────────────────────

    function test_Submit_ReturnsId() public {
        uint256 id = _submit(alice, agent, validCommitment);
        assertEq(id, 1);
    }

    function test_Submit_IncrementsCount() public {
        _submit(alice, agent,  validCommitment);
        _submit(bob,   agent2, validCommitment);
        assertEq(zkProof.commitmentCount(), 2);
    }

    function test_Submit_StatusPending() public {
        uint256 id = _submit(alice, agent, validCommitment);
        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.PENDING));
    }

    function test_Submit_EmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit CommitmentSubmitted(1, agent, alice, validCommitment, block.timestamp);

        vm.prank(alice);
        zkProof.submitCommitment(agent, validCommitment);
    }

    function test_Submit_StoresFields() public {
        vm.warp(1_700_000_000);
        uint256 id = _submit(alice, agent, validCommitment);

        ZKAuditProof.CommitmentRecord memory rec = zkProof.getCommitment(id);
        assertEq(rec.commitment,  validCommitment);
        assertEq(rec.agentId,     agent);
        assertEq(rec.submitter,   alice);
        assertEq(rec.submittedAt, 1_700_000_000);
        assertEq(rec.resolvedAt,  0);
        assertEq(uint(rec.status), uint(ZKAuditProof.Status.PENDING));
        assertEq(rec.inputHash,   bytes32(0));  // not revealed yet
        assertEq(rec.policyHash,  bytes32(0));  // not revealed yet
    }

    function test_Submit_SameCommitmentTwice_TwoSeparateRecords() public {
        uint256 id1 = _submit(alice, agent, validCommitment);
        uint256 id2 = _submit(alice, agent, validCommitment);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(zkProof.commitmentCount(), 2);
    }

    // ─────────────────────────────────────────────
    // submitCommitment — reverts
    // ─────────────────────────────────────────────

    function test_Submit_Reverts_ZeroAgentId() public {
        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: zero agentId");
        zkProof.submitCommitment(address(0), validCommitment);
    }

    function test_Submit_Reverts_EmptyCommitment() public {
        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: empty commitment");
        zkProof.submitCommitment(agent, bytes32(0));
    }

    // ─────────────────────────────────────────────
    // verifyProof — VERIFIED path
    // ─────────────────────────────────────────────

    function test_Verify_Success_StatusVerified() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.VERIFIED));
    }

    function test_Verify_Success_EmitsProofVerified() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.expectEmit(true, true, false, true);
        emit ProofVerified(id, agent, INPUT_HASH, POLICY_HASH, block.timestamp);

        vm.prank(alice);
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE);
    }

    function test_Verify_Success_RevealsInputAndPolicy() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        ZKAuditProof.CommitmentRecord memory rec = zkProof.getCommitment(id);
        assertEq(rec.inputHash,  INPUT_HASH);
        assertEq(rec.policyHash, POLICY_HASH);
    }

    function test_Verify_Success_SetsResolvedAt() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.warp(1_800_000_000);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        ZKAuditProof.CommitmentRecord memory rec = zkProof.getCommitment(id);
        assertEq(rec.resolvedAt, 1_800_000_000);
    }

    function test_Verify_Success_IsVerifiedTrue() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        assertTrue(zkProof.isVerified(id));
    }

    // ─────────────────────────────────────────────
    // verifyProof — FAILED path
    // ─────────────────────────────────────────────

    function test_Verify_WrongNonce_StatusFailed() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE + 1);   // wrong nonce

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.FAILED));
    }

    function test_Verify_WrongInput_StatusFailed() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, keccak256("wrong-input"), POLICY_HASH, NONCE);

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.FAILED));
    }

    function test_Verify_WrongPolicy_StatusFailed() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, keccak256("wrong-policy"), NONCE);

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.FAILED));
    }

    function test_Verify_Failed_EmitsProofFailed() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.expectEmit(true, true, false, true);
        emit ProofFailed(id, alice, block.timestamp);

        vm.prank(alice);
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE + 1);
    }

    function test_Verify_Failed_RevealsNothing() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE + 1);  // wrong nonce → FAILED

        ZKAuditProof.CommitmentRecord memory rec = zkProof.getCommitment(id);
        assertEq(rec.inputHash,  bytes32(0));  // stays zeroed — no partial disclosure
        assertEq(rec.policyHash, bytes32(0));
    }

    function test_Verify_Failed_IsVerifiedFalse() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE + 1);

        assertFalse(zkProof.isVerified(id));
    }

    // ─────────────────────────────────────────────
    // verifyProof — terminal states (no re-try)
    // ─────────────────────────────────────────────

    function test_Verify_Reverts_AlreadyVerified() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: already resolved");
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE);
    }

    function test_Verify_Reverts_AlreadyFailed() public {
        uint256 id = _submit(alice, agent, validCommitment);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE + 1);  // → FAILED

        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: already resolved");
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE);  // can't fix it
    }

    // ─────────────────────────────────────────────
    // verifyProof — access control
    // ─────────────────────────────────────────────

    function test_Verify_Reverts_NotSubmitter() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.prank(stranger);
        vm.expectRevert("ZKAuditProof: not submitter");
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE);
    }

    function test_Verify_Reverts_OriginalSubmitterCanVerify() public {
        // Positive: alice can verify her own commitment
        uint256 id = _submit(alice, agent, validCommitment);
        vm.prank(alice);
        zkProof.verifyProof(id, INPUT_HASH, POLICY_HASH, NONCE);  // no revert

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.VERIFIED));
    }

    // ─────────────────────────────────────────────
    // verifyProof — input validation reverts
    // ─────────────────────────────────────────────

    function test_Verify_Reverts_CommitmentNotFound_Zero() public {
        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.verifyProof(0, INPUT_HASH, POLICY_HASH, NONCE);
    }

    function test_Verify_Reverts_CommitmentNotFound_TooHigh() public {
        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.verifyProof(1, INPUT_HASH, POLICY_HASH, NONCE);
    }

    function test_Verify_Reverts_EmptyInputHash() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: empty inputHash");
        zkProof.verifyProof(id, bytes32(0), POLICY_HASH, NONCE);
    }

    function test_Verify_Reverts_EmptyPolicyHash() public {
        uint256 id = _submit(alice, agent, validCommitment);

        vm.prank(alice);
        vm.expectRevert("ZKAuditProof: empty policyHash");
        zkProof.verifyProof(id, INPUT_HASH, bytes32(0), NONCE);
    }

    // ─────────────────────────────────────────────
    // getCommitmentStatus — reverts
    // ─────────────────────────────────────────────

    function test_GetStatus_Reverts_NotFound() public {
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.getCommitmentStatus(0);
    }

    function test_GetStatus_Reverts_IdTooHigh() public {
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.getCommitmentStatus(1);
    }

    // ─────────────────────────────────────────────
    // getCommitment — reverts
    // ─────────────────────────────────────────────

    function test_GetCommitment_Reverts_NotFound() public {
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.getCommitment(0);
    }

    // ─────────────────────────────────────────────
    // isVerified — reverts
    // ─────────────────────────────────────────────

    function test_IsVerified_Reverts_NotFound() public {
        vm.expectRevert("ZKAuditProof: commitment not found");
        zkProof.isVerified(0);
    }

    function test_IsVerified_FalseWhilePending() public {
        uint256 id = _submit(alice, agent, validCommitment);
        assertFalse(zkProof.isVerified(id));
    }

    // ─────────────────────────────────────────────
    // getAgentCommitments
    // ─────────────────────────────────────────────

    function test_GetAgentCommitments_Empty() public view {
        uint256[] memory ids = zkProof.getAgentCommitments(agent);
        assertEq(ids.length, 0);
    }

    function test_GetAgentCommitments_MultipleSubmissions() public {
        bytes32 c2 = keccak256(abi.encodePacked(INPUT_HASH, POLICY_HASH, uint256(999)));

        _submit(alice, agent, validCommitment);
        _submit(bob,   agent, c2);                  // different submitter, same agentId
        _submit(alice, agent2, validCommitment);    // different agentId

        uint256[] memory agentIds  = zkProof.getAgentCommitments(agent);
        uint256[] memory agent2Ids = zkProof.getAgentCommitments(agent2);

        assertEq(agentIds.length,  2);
        assertEq(agentIds[0],      1);
        assertEq(agentIds[1],      2);
        assertEq(agent2Ids.length, 1);
        assertEq(agent2Ids[0],     3);
    }

    // ─────────────────────────────────────────────
    // computeCommitment — pure helper
    // ─────────────────────────────────────────────

    function test_ComputeCommitment_MatchesLocal() public view {
        bytes32 onChain = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, NONCE);
        assertEq(onChain, validCommitment);
    }

    function test_ComputeCommitment_DifferentNonce_DifferentResult() public view {
        bytes32 a = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, NONCE);
        bytes32 b = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, NONCE + 1);
        assertTrue(a != b);
    }

    function test_ComputeCommitment_DifferentInput_DifferentResult() public view {
        bytes32 a = zkProof.computeCommitment(INPUT_HASH,           POLICY_HASH, NONCE);
        bytes32 b = zkProof.computeCommitment(keccak256("other"),   POLICY_HASH, NONCE);
        assertTrue(a != b);
    }

    function test_ComputeCommitment_DifferentPolicy_DifferentResult() public view {
        bytes32 a = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH,         NONCE);
        bytes32 b = zkProof.computeCommitment(INPUT_HASH, keccak256("other"),  NONCE);
        assertTrue(a != b);
    }

    // ─────────────────────────────────────────────
    // Hiding property — commitment reveals nothing before reveal
    // ─────────────────────────────────────────────

    function test_Hiding_InputHashZeroedBeforeVerify() public {
        uint256 id = _submit(alice, agent, validCommitment);
        ZKAuditProof.CommitmentRecord memory rec = zkProof.getCommitment(id);

        assertEq(rec.inputHash,  bytes32(0));
        assertEq(rec.policyHash, bytes32(0));
    }

    function test_Hiding_TwoCommitmentsForSameInputLookDifferent() public {
        // Different nonces → different commitments even for identical (input, policy)
        bytes32 c1 = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, 1111);
        bytes32 c2 = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, 2222);
        assertTrue(c1 != c2);
    }

    // ─────────────────────────────────────────────
    // Binding property — wrong pre-image always fails
    // ─────────────────────────────────────────────

    function test_Binding_CannotFakeVerification() public {
        uint256 id = _submit(alice, agent, validCommitment);

        // Attacker cannot produce a passing pre-image unless they know (input, policy, nonce)
        bytes32 fakeInput  = keccak256("attacker-controlled");
        bytes32 fakePolicy = keccak256("attacker-policy");
        uint256 fakeNonce  = 42;

        _verify(alice, id, fakeInput, fakePolicy, fakeNonce);

        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.FAILED));
    }

    // ─────────────────────────────────────────────
    // End-to-end: full commit → verify workflow
    // ─────────────────────────────────────────────

    function test_EndToEnd_CommitThenVerify() public {
        // Step 1: off-chain the agent computes the commitment
        bytes32 commitment = zkProof.computeCommitment(INPUT_HASH, POLICY_HASH, NONCE);

        // Step 2: agent anchors commitment (nothing revealed)
        uint256 id = _submit(alice, agent, commitment);
        assertEq(uint(zkProof.getCommitmentStatus(id)), uint(ZKAuditProof.Status.PENDING));

        // Step 3: regulator calls getCommitment — sees commitment but not pre-image
        ZKAuditProof.CommitmentRecord memory before = zkProof.getCommitment(id);
        assertEq(before.inputHash,  bytes32(0));
        assertEq(before.policyHash, bytes32(0));

        // Step 4: agent decides to reveal (e.g. for regulatory audit)
        vm.warp(block.timestamp + 1 days);
        _verify(alice, id, INPUT_HASH, POLICY_HASH, NONCE);

        // Step 5: regulator can now inspect the on-chain proof
        ZKAuditProof.CommitmentRecord memory after_ = zkProof.getCommitment(id);
        assertEq(uint(after_.status), uint(ZKAuditProof.Status.VERIFIED));
        assertEq(after_.inputHash,  INPUT_HASH);
        assertEq(after_.policyHash, POLICY_HASH);
        assertTrue(zkProof.isVerified(id));
    }
}
