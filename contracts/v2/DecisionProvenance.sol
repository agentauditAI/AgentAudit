// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DecisionProvenance
/// @notice On-chain decision audit trail - EU AI Act Art. 50 + Art. 12
contract DecisionProvenance {

    struct Decision {
        uint256 id;
        bytes32 agentId;
        bytes32 inputHash;
        bytes32 outputHash;
        string  modelVersion;
        string  reasoning;
        uint256 confidence;
        address triggeredBy;
        uint256 timestamp;
        bool    humanReviewed;
        address reviewer;
    }

    mapping(uint256 => Decision) public decisions;
    mapping(bytes32 => uint256[]) public agentDecisions;
    uint256 public decisionCount;
    address public owner;

    event DecisionLogged(uint256 indexed id, bytes32 indexed agentId, bytes32 outputHash, uint256 timestamp);
    event DecisionReviewed(uint256 indexed id, address reviewer, uint256 timestamp);

    constructor() { owner = msg.sender; }

    function logDecision(
        bytes32 agentId,
        bytes32 inputHash,
        bytes32 outputHash,
        string calldata modelVersion,
        string calldata reasoning,
        uint256 confidence
    ) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(confidence <= 10000, "Confidence max 10000");
        uint256 id = ++decisionCount;
        decisions[id] = Decision({
            id: id,
            agentId: agentId,
            inputHash: inputHash,
            outputHash: outputHash,
            modelVersion: modelVersion,
            reasoning: reasoning,
            confidence: confidence,
            triggeredBy: msg.sender,
            timestamp: block.timestamp,
            humanReviewed: false,
            reviewer: address(0)
        });
        agentDecisions[agentId].push(id);
        emit DecisionLogged(id, agentId, outputHash, block.timestamp);
        return id;
    }

    function markHumanReviewed(uint256 id) external {
        require(decisions[id].id != 0, "Decision not found");
        require(!decisions[id].humanReviewed, "Already reviewed");
        decisions[id].humanReviewed = true;
        decisions[id].reviewer = msg.sender;
        emit DecisionReviewed(id, msg.sender, block.timestamp);
    }

    function getDecision(uint256 id) external view returns (Decision memory) {
        return decisions[id];
    }

    function getAgentDecisions(bytes32 agentId) external view returns (uint256[] memory) {
        return agentDecisions[agentId];
    }

    function verifyOutput(uint256 id, bytes32 outputHash) external view returns (bool) {
        return decisions[id].outputHash == outputHash;
    }
}
