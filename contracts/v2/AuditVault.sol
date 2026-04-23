// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AuditVault v2
/// @notice Hybrid on-chain/off-chain audit log for AI agent actions
/// @dev EU AI Act compliant — Articles 9, 13, 14, 15, 17, 72
/// @dev Architecture: full logs stored on IPFS/Arweave, only Merkle root committed on-chain
/// @dev This reduces gas costs by 100-500x vs naive per-event logging

contract AuditVault {

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    struct LogBatch {
        bytes32 merkleRoot;   // Merkle root of all log hashes in this batch
        string  contentURI;   // IPFS CID or Arweave txId with full log payload
        uint256 timestamp;    // block.timestamp at commit time
        uint256 blockNumber;  // block number for cross-referencing
        uint256 eventCount;   // number of events in this batch
        address submitter;    // address that submitted this batch
        uint8   complianceScore; // 0-100 EU AI Act compliance score for this batch
    }

    struct AgentInfo {
        bool    registered;
        string  agentType;    // e.g. "DeFi", "DAO", "Trading"
        string  framework;    // e.g. "ElizaOS", "LangChain"
        string  network;      // e.g. "Mantle", "Arbitrum"
        uint256 registeredAt;
        uint256 totalEvents;
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    // agentId => array of batches
    mapping(address => LogBatch[]) private _agentBatches;

    // agentId => agent metadata
    mapping(address => AgentInfo) private _agents;

    // agentId => total events logged across all batches
    mapping(address => uint256) public agentEventCount;

    // global batch count
    uint256 public totalBatches;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event AgentRegistered(
        address indexed agentId,
        string  agentType,
        string  framework,
        string  network,
        uint256 timestamp
    );

    event LogBatchCommitted(
        address indexed agentId,
        uint256 indexed batchIndex,
        bytes32 merkleRoot,
        string  contentURI,
        uint256 eventCount,
        uint8   complianceScore,
        uint256 timestamp
    );

    event HighRiskEventDetected(
        address indexed agentId,
        bytes32 merkleRoot,
        string  contentURI,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────
    // Agent Registration
    // ─────────────────────────────────────────────

    /// @notice Register an AI agent on-chain
    /// @param agentId    Address representing the agent (wallet or contract)
    /// @param agentType  Type of agent e.g. "DeFi", "DAO", "Trading"
    /// @param framework  Framework used e.g. "ElizaOS", "LangChain"
    /// @param network    Network where agent operates
    function registerAgent(
        address agentId,
        string calldata agentType,
        string calldata framework,
        string calldata network
    ) external {
        require(!_agents[agentId].registered, "AuditVault: agent already registered");

        _agents[agentId] = AgentInfo({
            registered:   true,
            agentType:    agentType,
            framework:    framework,
            network:      network,
            registeredAt: block.timestamp,
            totalEvents:  0
        });

        emit AgentRegistered(agentId, agentType, framework, network, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Batch Commit (main write function)
    // ─────────────────────────────────────────────

    /// @notice Commit a batch of agent action logs on-chain
    /// @param agentId         Address of the AI agent
    /// @param merkleRoot      Merkle root of all log hashes in this batch
    /// @param contentURI      IPFS CID or Arweave txId with full log payload
    /// @param eventCount      Number of events in this batch
    /// @param complianceScore EU AI Act compliance score 0-100
    function commitBatch(
        address agentId,
        bytes32 merkleRoot,
        string  calldata contentURI,
        uint256 eventCount,
        uint8   complianceScore
    ) external {
        require(merkleRoot != bytes32(0), "AuditVault: empty merkle root");
        require(bytes(contentURI).length > 0, "AuditVault: empty contentURI");
        require(eventCount > 0, "AuditVault: zero event count");
        require(complianceScore <= 100, "AuditVault: score exceeds 100");

        uint256 batchIndex = _agentBatches[agentId].length;

        _agentBatches[agentId].push(LogBatch({
            merkleRoot:      merkleRoot,
            contentURI:      contentURI,
            timestamp:       block.timestamp,
            blockNumber:     block.number,
            eventCount:      eventCount,
            submitter:       msg.sender,
            complianceScore: complianceScore
        }));

        agentEventCount[agentId] += eventCount;
        _agents[agentId].totalEvents += eventCount;
        totalBatches++;

        emit LogBatchCommitted(
            agentId,
            batchIndex,
            merkleRoot,
            contentURI,
            eventCount,
            complianceScore,
            block.timestamp
        );
    }

    /// @notice Commit a high-risk event immediately (bypasses batch buffer)
    /// @dev Use for critical events requiring instant on-chain record
    function commitHighRiskEvent(
        address agentId,
        bytes32 merkleRoot,
        string  calldata contentURI
    ) external {
        require(merkleRoot != bytes32(0), "AuditVault: empty merkle root");

        // High-risk events are committed as single-event batches with score 0
        _agentBatches[agentId].push(LogBatch({
            merkleRoot:      merkleRoot,
            contentURI:      contentURI,
            timestamp:       block.timestamp,
            blockNumber:     block.number,
            eventCount:      1,
            submitter:       msg.sender,
            complianceScore: 0
        }));

        agentEventCount[agentId] += 1;
        totalBatches++;

        emit HighRiskEventDetected(agentId, merkleRoot, contentURI, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Merkle Verification
    // ─────────────────────────────────────────────

    /// @notice Verify that a single log belongs to a committed batch
    /// @param agentId     Address of the AI agent
    /// @param batchIndex  Index of the batch to verify against
    /// @param logHash     keccak256 hash of the individual log entry
    /// @param proof       Merkle proof path
    /// @return true if the log is part of the committed batch
    function verifyLog(
        address agentId,
        uint256 batchIndex,
        bytes32 logHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        require(batchIndex < _agentBatches[agentId].length, "AuditVault: batch not found");
        bytes32 root = _agentBatches[agentId][batchIndex].merkleRoot;
        return _verifyMerkle(proof, root, logHash);
    }

    /// @dev Internal Merkle proof verification
    function _verifyMerkle(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (computed <= proof[i]) {
                computed = keccak256(abi.encodePacked(computed, proof[i]));
            } else {
                computed = keccak256(abi.encodePacked(proof[i], computed));
            }
        }
        return computed == root;
    }

    // ─────────────────────────────────────────────
    // Read Functions
    // ─────────────────────────────────────────────

    /// @notice Get a specific batch for an agent
    function getBatch(address agentId, uint256 batchIndex)
        external view returns (LogBatch memory)
    {
        require(batchIndex < _agentBatches[agentId].length, "AuditVault: batch not found");
        return _agentBatches[agentId][batchIndex];
    }

    /// @notice Get total number of batches for an agent
    function getBatchCount(address agentId) external view returns (uint256) {
        return _agentBatches[agentId].length;
    }

    /// @notice Get all batches for an agent
    function getAllBatches(address agentId)
        external view returns (LogBatch[] memory)
    {
        return _agentBatches[agentId];
    }

    /// @notice Get agent info
    function getAgentInfo(address agentId)
        external view returns (AgentInfo memory)
    {
        return _agents[agentId];
    }

    /// @notice Get latest compliance score for an agent
    function getLatestComplianceScore(address agentId)
        external view returns (uint8)
    {
        uint256 count = _agentBatches[agentId].length;
        require(count > 0, "AuditVault: no batches for agent");
        return _agentBatches[agentId][count - 1].complianceScore;
    }

    /// @notice Check if agent is registered
    function isRegistered(address agentId) external view returns (bool) {
        return _agents[agentId].registered;
    }
}
