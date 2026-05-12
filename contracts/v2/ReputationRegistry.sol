// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ReputationRegistry
/// @notice Agent reputation scoring + EU AI Act compliance tags — ERC-8004 Sprint B
contract ReputationRegistry {

    struct ReputationRecord {
        bytes32 agentId;
        uint256 totalScore;
        uint256 feedbackCount;
        uint256 complianceScore;   // 0-100, from EUAIActReporter
        bool    euAiActCompliant;
        uint256 lastUpdated;
    }

    struct Feedback {
        uint256 id;
        bytes32 agentId;
        address submittedBy;
        uint8   score;             // 1-5
        string  comment;
        uint256 timestamp;
    }

    mapping(bytes32 => ReputationRecord) public reputation;
    mapping(uint256 => Feedback) public feedbacks;
    mapping(bytes32 => uint256[]) public agentFeedbacks;
    uint256 public feedbackCount;
    address public owner;

    event FeedbackSubmitted(uint256 indexed id, bytes32 indexed agentId, uint8 score, address submittedBy);
    event ComplianceTagUpdated(bytes32 indexed agentId, bool compliant, uint256 complianceScore);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() { owner = msg.sender; }

    function submitFeedback(bytes32 agentId, uint8 score, string calldata comment) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(score >= 1 && score <= 5, "Score must be 1-5");

        uint256 id = ++feedbackCount;
        feedbacks[id] = Feedback({
            id: id,
            agentId: agentId,
            submittedBy: msg.sender,
            score: score,
            comment: comment,
            timestamp: block.timestamp
        });

        agentFeedbacks[agentId].push(id);
        reputation[agentId].totalScore += score;
        reputation[agentId].feedbackCount++;
        reputation[agentId].agentId = agentId;
        reputation[agentId].lastUpdated = block.timestamp;

        emit FeedbackSubmitted(id, agentId, score, msg.sender);
        return id;
    }

    function updateComplianceTag(bytes32 agentId, bool compliant, uint256 complianceScore) external onlyOwner {
        require(agentId != bytes32(0), "Invalid agentId");
        require(complianceScore <= 100, "Score max 100");
        reputation[agentId].euAiActCompliant = compliant;
        reputation[agentId].complianceScore = complianceScore;
        reputation[agentId].lastUpdated = block.timestamp;
        emit ComplianceTagUpdated(agentId, compliant, complianceScore);
    }

    function getAverageScore(bytes32 agentId) external view returns (uint256) {
        ReputationRecord memory r = reputation[agentId];
        if (r.feedbackCount == 0) return 0;
        return (r.totalScore * 100) / r.feedbackCount;
    }

    function getReputation(bytes32 agentId) external view returns (ReputationRecord memory) {
        return reputation[agentId];
    }

    function getAgentFeedbacks(bytes32 agentId) external view returns (uint256[] memory) {
        return agentFeedbacks[agentId];
    }
}
