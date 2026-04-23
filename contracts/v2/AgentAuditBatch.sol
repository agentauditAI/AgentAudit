// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentAuditBatch
 * @notice Gas-optimized batch audit logging for AI agents
 * @dev Stores audit entries as events — cheaper than storage, permanently queryable
 */
contract AgentAuditBatch {

    struct AuditEntry {
        uint256 agentId;
        string actionType;
        bytes32 payloadHash;
        uint256 timestamp;
    }

    event AuditLogged(
        uint256 indexed agentId,
        string actionType,
        bytes32 payloadHash,
        uint256 timestamp
    );

    event AuditBatchLogged(
        uint256 indexed agentId,
        uint256 count,
        uint256 timestamp
    );

    mapping(uint256 => uint256) public agentLogCount;

    /**
     * @notice Log a single agent action
     */
    function logAction(
        uint256 agentId,
        string calldata actionType,
        bytes32 payloadHash
    ) external {
        agentLogCount[agentId]++;

        emit AuditLogged(
            agentId,
            actionType,
            payloadHash,
            block.timestamp
        );
    }

    /**
     * @notice Log multiple agent actions in one transaction (gas efficient)
     */
    function logActionBatch(
        uint256 agentId,
        string[] calldata actionTypes,
        bytes32[] calldata payloadHashes
    ) external {
        require(actionTypes.length == payloadHashes.length, "Array length mismatch");
        require(actionTypes.length > 0, "Empty batch");

        uint256 count = actionTypes.length;
        agentLogCount[agentId] += count;

        for (uint256 i = 0; i < count; i++) {
            emit AuditLogged(
                agentId,
                actionTypes[i],
                payloadHashes[i],
                block.timestamp
            );
        }

        emit AuditBatchLogged(agentId, count, block.timestamp);
    }

    /**
     * @notice Get total log count for an agent
     */
    function getLogCount(uint256 agentId) external view returns (uint256) {
        return agentLogCount[agentId];
    }
}