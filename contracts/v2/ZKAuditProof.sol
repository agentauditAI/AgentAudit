// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZKAuditProof
/// @notice Zero-knowledge audit proof registry — privacy-preserving EU AI Act compliance
/// @dev Stores ZK proof hashes without revealing underlying audit data
contract ZKAuditProof {

    enum ProofStatus { PENDING, VERIFIED, REJECTED, EXPIRED }

    struct AuditProof {
        uint256 id;
        bytes32 agentId;
        bytes32 proofHash;        // hash of ZK proof
        bytes32 publicInputHash;  // hash of public inputs
        bytes32 circuitId;        // which ZK circuit was used
        ProofStatus status;
        address submittedBy;
        address verifiedBy;
        uint256 submittedAt;
        uint256 verifiedAt;
        uint256 expiresAt;
        bool    complianceResult; // true = compliant
    }

    mapping(uint256 => AuditProof) public proofs;
    mapping(bytes32 => uint256[]) public agentProofs;
    mapping(bytes32 => bool) public usedProofHashes;
    uint256 public proofCount;
    address public owner;

    uint256 public constant PROOF_VALIDITY = 180 days;

    event ProofSubmitted(uint256 indexed id, bytes32 indexed agentId, bytes32 proofHash, uint256 timestamp);
    event ProofVerified(uint256 indexed id, bool complianceResult, uint256 timestamp);
    event ProofRejected(uint256 indexed id, uint256 timestamp);
    event ProofExpired(uint256 indexed id, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() { owner = msg.sender; }

    function submitProof(
        bytes32 agentId,
        bytes32 proofHash,
        bytes32 publicInputHash,
        bytes32 circuitId
    ) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(proofHash != bytes32(0), "Invalid proofHash");
        require(!usedProofHashes[proofHash], "Proof already used");

        uint256 id = ++proofCount;
        usedProofHashes[proofHash] = true;

        proofs[id] = AuditProof({
            id: id,
            agentId: agentId,
            proofHash: proofHash,
            publicInputHash: publicInputHash,
            circuitId: circuitId,
            status: ProofStatus.PENDING,
            submittedBy: msg.sender,
            verifiedBy: address(0),
            submittedAt: block.timestamp,
            verifiedAt: 0,
            expiresAt: block.timestamp + PROOF_VALIDITY,
            complianceResult: false
        });

        agentProofs[agentId].push(id);
        emit ProofSubmitted(id, agentId, proofHash, block.timestamp);
        return id;
    }

    function verifyProof(uint256 id, bool complianceResult) external onlyOwner {
        AuditProof storage p = proofs[id];
        require(p.id != 0, "Proof not found");
        require(p.status == ProofStatus.PENDING, "Not pending");
        require(block.timestamp <= p.expiresAt, "Proof expired");

        p.status = ProofStatus.VERIFIED;
        p.complianceResult = complianceResult;
        p.verifiedBy = msg.sender;
        p.verifiedAt = block.timestamp;

        emit ProofVerified(id, complianceResult, block.timestamp);
    }

    function rejectProof(uint256 id) external onlyOwner {
        AuditProof storage p = proofs[id];
        require(p.id != 0, "Proof not found");
        require(p.status == ProofStatus.PENDING, "Not pending");
        p.status = ProofStatus.REJECTED;
        emit ProofRejected(id, block.timestamp);
    }

    function isValidProof(uint256 id) external view returns (bool) {
        AuditProof storage p = proofs[id];
        return p.status == ProofStatus.VERIFIED &&
               p.complianceResult &&
               block.timestamp <= p.expiresAt;
    }

    function getLatestValidProof(bytes32 agentId) external view returns (uint256) {
        uint256[] memory ids = agentProofs[agentId];
        for (uint256 i = ids.length; i > 0; i--) {
            AuditProof storage p = proofs[ids[i-1]];
            if (p.status == ProofStatus.VERIFIED && p.complianceResult && block.timestamp <= p.expiresAt) {
                return ids[i-1];
            }
        }
        return 0;
    }

    function getProof(uint256 id) external view returns (AuditProof memory) {
        return proofs[id];
    }

    function getAgentProofs(bytes32 agentId) external view returns (uint256[] memory) {
        return agentProofs[agentId];
    }
}
