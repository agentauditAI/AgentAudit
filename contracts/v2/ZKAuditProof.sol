// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZKAuditProof
/// @notice Hash-based commitment scheme for privacy-preserving AI agent audit proofs.
/// @dev    This is NOT a SNARK/STARK. It is a Pedersen-style commitment using keccak256,
///         which achieves the core ZK property for audit use-cases:
///         an agent can prove it acted under a specific policy WITHOUT revealing
///         the raw prompt, raw policy text, or any other sensitive detail.
///
///         Off-chain workflow (three steps):
///           1. Compute locally (never sent on-chain):
///                nonce      = cryptographically random uint256
///                commitment = keccak256(abi.encodePacked(inputHash, policyHash, nonce))
///           2. Submit: call submitCommitment(agentId, commitment)
///                → commitment is anchored on-chain; nothing about input/policy is revealed
///           3. Reveal: call verifyProof(commitmentId, inputHash, policyHash, nonce)
///                → contract re-computes the hash and sets status VERIFIED or FAILED
///
///         inputHash  = keccak256(raw_prompt + context)   — privacy-preserving; raw data stays off-chain
///         policyHash = keccak256(policy_document_bytes)  — tamper-evident reference to exact policy
///         nonce      = random uint256                    — prevents dictionary/brute-force attacks
///
///         Privacy guarantees:
///           • Binding:   once submitted, the commitment uniquely determines (input, policy, nonce)
///           • Hiding:    the commitment reveals nothing about the pre-image (keccak256 is one-way)
///           • Selective: only the submitter can trigger the reveal (prevents griefing / forced disclosure)
contract ZKAuditProof {

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    enum Status { PENDING, VERIFIED, FAILED }

    struct CommitmentRecord {
        bytes32 commitment;   // keccak256(abi.encodePacked(inputHash, policyHash, nonce))
        address agentId;      // AI agent this proof covers
        address submitter;    // msg.sender at submit time — only they may trigger reveal
        uint256 submittedAt;  // block.timestamp when commitment was anchored
        uint256 resolvedAt;   // block.timestamp of verifyProof call; 0 while PENDING
        Status  status;
        // revealed on successful verification — zeroed while PENDING or FAILED
        bytes32 inputHash;    // keccak256 of the agent's input data
        bytes32 policyHash;   // keccak256 of the policy document
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    mapping(uint256 => CommitmentRecord) private _commitments;
    uint256 public commitmentCount;

    // agentId => ordered list of commitmentIds for that agent
    mapping(address => uint256[]) private _agentCommitments;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event CommitmentSubmitted(
        uint256 indexed commitmentId,
        address indexed agentId,
        address indexed submitter,
        bytes32         commitment,
        uint256         timestamp
    );

    /// @notice Emitted on successful reveal.
    ///         inputHash and policyHash are now on-chain — auditors can cross-reference
    ///         against known policy hashes to confirm compliance tier.
    event ProofVerified(
        uint256 indexed commitmentId,
        address indexed agentId,
        bytes32         inputHash,
        bytes32         policyHash,
        uint256         timestamp
    );

    /// @notice Emitted when the supplied pre-image does not match the stored commitment.
    ///         This is a terminal state — the commitment cannot be re-tried.
    event ProofFailed(
        uint256 indexed commitmentId,
        address indexed submitter,
        uint256         timestamp
    );

    // ─────────────────────────────────────────────
    // Write Functions
    // ─────────────────────────────────────────────

    /// @notice Anchor a commitment on-chain without revealing the pre-image.
    /// @param agentId    Address of the AI agent this proof covers
    /// @param commitment keccak256(abi.encodePacked(inputHash, policyHash, nonce)) — computed off-chain
    /// @return commitmentId Sequential ID; pass this to verifyProof when ready to reveal
    function submitCommitment(address agentId, bytes32 commitment)
        external
        returns (uint256 commitmentId)
    {
        require(agentId    != address(0),  "ZKAuditProof: zero agentId");
        require(commitment != bytes32(0),  "ZKAuditProof: empty commitment");

        commitmentId = ++commitmentCount;

        _commitments[commitmentId] = CommitmentRecord({
            commitment:  commitment,
            agentId:     agentId,
            submitter:   msg.sender,
            submittedAt: block.timestamp,
            resolvedAt:  0,
            status:      Status.PENDING,
            inputHash:   bytes32(0),
            policyHash:  bytes32(0)
        });

        _agentCommitments[agentId].push(commitmentId);

        emit CommitmentSubmitted(commitmentId, agentId, msg.sender, commitment, block.timestamp);
    }

    /// @notice Reveal the pre-image and settle the commitment as VERIFIED or FAILED.
    ///         Re-computes keccak256(abi.encodePacked(inputHash, policyHash, nonce)) and
    ///         compares to the stored commitment. Result is TERMINAL — no re-tries.
    /// @dev    Only the original submitter may call this to keep disclosure voluntary.
    ///         On VERIFIED, inputHash and policyHash are written to storage for audit trail.
    ///         On FAILED,   the revealed fields remain zeroed to avoid storing garbage.
    /// @param commitmentId ID returned by submitCommitment
    /// @param inputHash    keccak256 of the agent's input (prompt + context) — NOT the raw data
    /// @param policyHash   keccak256 of the policy document in force when the action was taken
    /// @param nonce        The random uint256 used when computing the commitment off-chain
    function verifyProof(
        uint256 commitmentId,
        bytes32 inputHash,
        bytes32 policyHash,
        uint256 nonce
    ) external {
        require(
            commitmentId > 0 && commitmentId <= commitmentCount,
            "ZKAuditProof: commitment not found"
        );

        CommitmentRecord storage rec = _commitments[commitmentId];

        require(rec.submitter == msg.sender,    "ZKAuditProof: not submitter");
        require(rec.status == Status.PENDING,   "ZKAuditProof: already resolved");
        require(inputHash  != bytes32(0),       "ZKAuditProof: empty inputHash");
        require(policyHash != bytes32(0),       "ZKAuditProof: empty policyHash");

        bytes32 computed = keccak256(abi.encodePacked(inputHash, policyHash, nonce));

        rec.resolvedAt = block.timestamp;

        if (computed == rec.commitment) {
            rec.status     = Status.VERIFIED;
            rec.inputHash  = inputHash;
            rec.policyHash = policyHash;

            emit ProofVerified(commitmentId, rec.agentId, inputHash, policyHash, block.timestamp);
        } else {
            rec.status = Status.FAILED;

            emit ProofFailed(commitmentId, msg.sender, block.timestamp);
        }
    }

    // ─────────────────────────────────────────────
    // Read Functions
    // ─────────────────────────────────────────────

    /// @notice Return the status of a commitment.
    function getCommitmentStatus(uint256 commitmentId) external view returns (Status) {
        require(
            commitmentId > 0 && commitmentId <= commitmentCount,
            "ZKAuditProof: commitment not found"
        );
        return _commitments[commitmentId].status;
    }

    /// @notice Return the full CommitmentRecord. Note: inputHash/policyHash are zeroed
    ///         until VERIFIED — this is intentional (no partial disclosure).
    function getCommitment(uint256 commitmentId)
        external view
        returns (CommitmentRecord memory)
    {
        require(
            commitmentId > 0 && commitmentId <= commitmentCount,
            "ZKAuditProof: commitment not found"
        );
        return _commitments[commitmentId];
    }

    /// @notice Return all commitmentIds submitted for a given agent, in submission order.
    function getAgentCommitments(address agentId)
        external view
        returns (uint256[] memory)
    {
        return _agentCommitments[agentId];
    }

    /// @notice Returns true iff the commitment has been successfully verified.
    function isVerified(uint256 commitmentId) external view returns (bool) {
        require(
            commitmentId > 0 && commitmentId <= commitmentCount,
            "ZKAuditProof: commitment not found"
        );
        return _commitments[commitmentId].status == Status.VERIFIED;
    }

    /// @notice Pure helper: compute the commitment hash off-chain equivalent.
    ///         Use this to verify your local computation matches the on-chain scheme
    ///         before calling submitCommitment.
    function computeCommitment(bytes32 inputHash, bytes32 policyHash, uint256 nonce)
        external pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(inputHash, policyHash, nonce));
    }
}
