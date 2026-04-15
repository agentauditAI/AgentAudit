// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AuditVault
/// @notice Immutable on-chain audit log for AI agent actions
/// @dev EU AI Act compliant logging — Articles 12, 13, 14, 17
contract AuditVault {

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    struct LogEntry {
        address agent;       // address of the AI agent (or operator wallet)
        string  action;      // action identifier e.g. "TRANSFER_APPROVED"
        string  metadata;    // JSON-encoded context
        uint256 timestamp;   // block.timestamp at the time of logging
        uint256 blockNumber; // block number for cross-referencing
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    LogEntry[] private _logs;

    mapping(address => uint256[]) private _agentLogIndexes;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event ActionLogged(
        uint256 indexed logIndex,
        address indexed agent,
        string  action,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────
    // Write
    // ─────────────────────────────────────────────

    /// @notice Log an agent action on-chain
    /// @param action  Short action identifier (e.g. "TRANSFER_APPROVED")
    /// @param metadata JSON string with additional context
    function logAction(
        string calldata action,
        string calldata metadata
    ) external returns (uint256 logIndex) {
        logIndex = _logs.length;

        _logs.push(LogEntry({
            agent:       msg.sender,
            action:      action,
            metadata:    metadata,
            timestamp:   block.timestamp,
            blockNumber: block.number
        }));

        _agentLogIndexes[msg.sender].push(logIndex);

        emit ActionLogged(logIndex, msg.sender, action, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────

    /// @notice Retrieve a log entry by global index
    function getLog(uint256 index) external view returns (LogEntry memory) {
        require(index < _logs.length, "AuditVault: index out of bounds");
        return _logs[index];
    }

    /// @notice Total number of logs ever written
    function totalLogs() external view returns (uint256) {
        return _logs.length;
    }

    /// @notice All log indexes written by a specific agent address
    function getAgentLogIndexes(address agent)
        external
        view
        returns (uint256[] memory)
    {
        return _agentLogIndexes[agent];
    }

    /// @notice All logs written by a specific agent address
    function getAgentLogs(address agent)
        external
        view
        returns (LogEntry[] memory)
    {
        uint256[] memory indexes = _agentLogIndexes[agent];
        LogEntry[] memory result = new LogEntry[](indexes.length);
        for (uint256 i = 0; i < indexes.length; i++) {
            result[i] = _logs[indexes[i]];
        }
        return result;
    }
}
