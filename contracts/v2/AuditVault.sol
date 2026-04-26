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

    enum RiskLevel { LOW, MEDIUM, HIGH }

    struct LogBatch {
        bytes32   merkleRoot;       // Merkle root of all log hashes in this batch
        string    contentURI;       // IPFS CID or Arweave txId with full log payload
        uint256   timestamp;        // block.timestamp at commit time
        uint256   blockNumber;      // block number for cross-referencing
        uint256   eventCount;       // number of events in this batch
        address   submitter;        // address that submitted this batch
        uint8     complianceScore;  // 0-100 EU AI Act compliance score for this batch
        bool      hasParent;        // true if this batch is a child in an audit chain
        address   parentAgentId;    // agentId of the parent batch (zero if root)
        uint256   parentBatchIndex; // index of the parent batch (zero if root)
        RiskLevel riskLevel;        // computed risk classification for this batch
    }

    struct AgentInfo {
        bool    registered;
        string  agentType;    // e.g. "DeFi", "DAO", "Trading"
        string  framework;    // e.g. "ElizaOS", "LangChain"
        string  network;      // e.g. "Mantle", "Arbitrum"
        uint256 registeredAt;
        uint256 totalEvents;
    }

    /// @notice Reference to a specific batch by agent + index
    struct BatchRef {
        address agentId;
        uint256 batchIndex;
    }

    /// @notice Full risk metadata stored separately from LogBatch to keep getBatch() lean
    struct RiskScore {
        RiskLevel level;
        string    actionType;  // dominant action type submitted with this batch
        uint256   spendValue;  // total spend value (in wei) submitted with this batch
        uint256   timestamp;
    }

    // ─────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────

    uint256 public constant RISK_THRESHOLD_HIGH   = 10 ether;
    uint256 public constant RISK_THRESHOLD_MEDIUM =  1 ether;

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    // agentId => array of batches
    mapping(address => LogBatch[]) private _agentBatches;

    // agentId => agent metadata
    mapping(address => AgentInfo) private _agents;

    // agentId => total events logged across all batches
    mapping(address => uint256) public agentEventCount;

    // parentAgentId => parentBatchIndex => list of direct child BatchRefs
    mapping(address => mapping(uint256 => BatchRef[])) private _childBatches;

    // agentId => batchIndex => full risk score details
    mapping(address => mapping(uint256 => RiskScore)) private _riskScores;

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

    /// @notice Emitted when a child batch is committed as part of a multi-agent chain
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

    event HighRiskEventDetected(
        address indexed agentId,
        bytes32 merkleRoot,
        string  contentURI,
        uint256 timestamp
    );

    /// @notice Emitted whenever a risk score is computed and stored for a batch
    event RiskScoreAssigned(
        address   indexed agentId,
        uint256   indexed batchIndex,
        RiskLevel indexed level,
        string    actionType,
        uint256   spendValue,
        uint256   timestamp
    );

    // ─────────────────────────────────────────────
    // Agent Registration
    // ─────────────────────────────────────────────

    /// @notice Register an AI agent on-chain
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
    // Batch Commit (main write functions)
    // ─────────────────────────────────────────────

    /// @notice Commit a root batch of agent action logs (no parent)
    /// @param agentId         Address of the AI agent
    /// @param merkleRoot      Merkle root of all log hashes in this batch
    /// @param contentURI      IPFS CID or Arweave txId with full log payload
    /// @param eventCount      Number of events in this batch
    /// @param complianceScore EU AI Act compliance score 0-100
    /// @param actionType      Dominant action type in this batch (e.g. "TRANSFER", "SWAP")
    /// @param spendValue      Total spend value in wei associated with this batch
    function commitBatch(
        address agentId,
        bytes32 merkleRoot,
        string  calldata contentURI,
        uint256 eventCount,
        uint8   complianceScore,
        string  calldata actionType,
        uint256 spendValue
    ) external {
        require(merkleRoot != bytes32(0), "AuditVault: empty merkle root");
        require(bytes(contentURI).length > 0, "AuditVault: empty contentURI");
        require(eventCount > 0, "AuditVault: zero event count");
        require(complianceScore <= 100, "AuditVault: score exceeds 100");

        RiskLevel risk = _computeRisk(actionType, spendValue);
        uint256 batchIndex = _agentBatches[agentId].length;

        _agentBatches[agentId].push(LogBatch({
            merkleRoot:       merkleRoot,
            contentURI:       contentURI,
            timestamp:        block.timestamp,
            blockNumber:      block.number,
            eventCount:       eventCount,
            submitter:        msg.sender,
            complianceScore:  complianceScore,
            hasParent:        false,
            parentAgentId:    address(0),
            parentBatchIndex: 0,
            riskLevel:        risk
        }));

        _storeRiskScore(agentId, batchIndex, risk, actionType, spendValue);

        agentEventCount[agentId] += eventCount;
        _agents[agentId].totalEvents += eventCount;
        totalBatches++;

        emit LogBatchCommitted(
            agentId, batchIndex, merkleRoot, contentURI, eventCount, complianceScore, block.timestamp
        );
    }

    /// @notice Commit a child batch linked to a parent agent's batch
    /// @dev Cycles are structurally impossible — a parent must exist before a child can reference it.
    /// @param agentId           Address of the child AI agent
    /// @param merkleRoot        Merkle root of all log hashes in this batch
    /// @param contentURI        IPFS CID or Arweave txId with full log payload
    /// @param eventCount        Number of events in this batch
    /// @param complianceScore   EU AI Act compliance score 0-100
    /// @param actionType        Dominant action type in this batch
    /// @param spendValue        Total spend value in wei associated with this batch
    /// @param parentAgentId     Address of the parent agent
    /// @param parentBatchIndex  Index of the parent batch within parentAgentId's batch array
    function commitChildBatch(
        address agentId,
        bytes32 merkleRoot,
        string  calldata contentURI,
        uint256 eventCount,
        uint8   complianceScore,
        string  calldata actionType,
        uint256 spendValue,
        address parentAgentId,
        uint256 parentBatchIndex
    ) external {
        require(merkleRoot != bytes32(0), "AuditVault: empty merkle root");
        require(bytes(contentURI).length > 0, "AuditVault: empty contentURI");
        require(eventCount > 0, "AuditVault: zero event count");
        require(complianceScore <= 100, "AuditVault: score exceeds 100");
        require(parentAgentId != address(0), "AuditVault: zero parent agent");
        require(
            parentBatchIndex < _agentBatches[parentAgentId].length,
            "AuditVault: parent batch not found"
        );

        RiskLevel risk = _computeRisk(actionType, spendValue);
        uint256 batchIndex = _agentBatches[agentId].length;

        _agentBatches[agentId].push(LogBatch({
            merkleRoot:       merkleRoot,
            contentURI:       contentURI,
            timestamp:        block.timestamp,
            blockNumber:      block.number,
            eventCount:       eventCount,
            submitter:        msg.sender,
            complianceScore:  complianceScore,
            hasParent:        true,
            parentAgentId:    parentAgentId,
            parentBatchIndex: parentBatchIndex,
            riskLevel:        risk
        }));

        _childBatches[parentAgentId][parentBatchIndex].push(BatchRef({
            agentId:    agentId,
            batchIndex: batchIndex
        }));

        _storeRiskScore(agentId, batchIndex, risk, actionType, spendValue);

        agentEventCount[agentId] += eventCount;
        _agents[agentId].totalEvents += eventCount;
        totalBatches++;

        emit ChildBatchCommitted(
            agentId, batchIndex, parentAgentId, parentBatchIndex,
            merkleRoot, contentURI, eventCount, complianceScore, block.timestamp
        );
    }

    /// @notice Commit a high-risk event immediately (bypasses batch buffer)
    /// @dev Always assigned RiskLevel.HIGH regardless of action type or spend.
    function commitHighRiskEvent(
        address agentId,
        bytes32 merkleRoot,
        string  calldata contentURI
    ) external {
        require(merkleRoot != bytes32(0), "AuditVault: empty merkle root");

        uint256 batchIndex = _agentBatches[agentId].length;

        _agentBatches[agentId].push(LogBatch({
            merkleRoot:       merkleRoot,
            contentURI:       contentURI,
            timestamp:        block.timestamp,
            blockNumber:      block.number,
            eventCount:       1,
            submitter:        msg.sender,
            complianceScore:  0,
            hasParent:        false,
            parentAgentId:    address(0),
            parentBatchIndex: 0,
            riskLevel:        RiskLevel.HIGH
        }));

        _storeRiskScore(agentId, batchIndex, RiskLevel.HIGH, "HIGH_RISK_EVENT", 0);

        agentEventCount[agentId] += 1;
        totalBatches++;

        emit HighRiskEventDetected(agentId, merkleRoot, contentURI, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Risk Scoring (internal)
    // ─────────────────────────────────────────────

    /// @dev Computes risk level from action type and spend value.
    ///      Action type match is done via keccak256 to avoid O(n) string comparison.
    ///      Spend thresholds: HIGH > 10 ETH, MEDIUM > 1 ETH.
    function _computeRisk(string calldata actionType, uint256 spendValue)
        internal pure returns (RiskLevel)
    {
        bytes32 action = keccak256(bytes(actionType));

        if (
            action == keccak256("TRANSFER")      ||
            action == keccak256("WITHDRAW")      ||
            action == keccak256("LIQUIDATE")     ||
            action == keccak256("EMERGENCY_EXIT")||
            action == keccak256("BRIDGE")        ||
            action == keccak256("DRAIN")
        ) return RiskLevel.HIGH;

        if (spendValue > RISK_THRESHOLD_HIGH) return RiskLevel.HIGH;

        if (
            action == keccak256("SWAP")    ||
            action == keccak256("APPROVE") ||
            action == keccak256("DELEGATE")||
            action == keccak256("STAKE")   ||
            action == keccak256("UNSTAKE") ||
            action == keccak256("BORROW")  ||
            action == keccak256("REPAY")
        ) return RiskLevel.MEDIUM;

        if (spendValue > RISK_THRESHOLD_MEDIUM) return RiskLevel.MEDIUM;

        return RiskLevel.LOW;
    }

    function _storeRiskScore(
        address agentId,
        uint256 batchIndex,
        RiskLevel level,
        string memory actionType,
        uint256 spendValue
    ) internal {
        _riskScores[agentId][batchIndex] = RiskScore({
            level:      level,
            actionType: actionType,
            spendValue: spendValue,
            timestamp:  block.timestamp
        });

        emit RiskScoreAssigned(agentId, batchIndex, level, actionType, spendValue, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Merkle Verification
    // ─────────────────────────────────────────────

    /// @notice Verify that a single log belongs to a committed batch
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
    // Multi-Agent Chain Read Functions
    // ─────────────────────────────────────────────

    /// @notice Get all direct children of a given batch
    function getChildBatches(address parentAgentId, uint256 parentBatchIndex)
        external view returns (BatchRef[] memory)
    {
        require(
            parentBatchIndex < _agentBatches[parentAgentId].length,
            "AuditVault: parent batch not found"
        );
        return _childBatches[parentAgentId][parentBatchIndex];
    }

    /// @notice Traverse the parent chain up to the root (max 32 hops)
    /// @return chain Ancestors ordered parent-first, root-last
    function getAncestorChain(address agentId, uint256 batchIndex)
        external view returns (BatchRef[] memory chain)
    {
        uint256 maxDepth = 32;
        BatchRef[] memory temp = new BatchRef[](maxDepth);
        uint256 depth = 0;

        address currentAgent = agentId;
        uint256 currentBatch = batchIndex;

        while (depth < maxDepth) {
            require(
                currentBatch < _agentBatches[currentAgent].length,
                "AuditVault: batch not found"
            );
            LogBatch storage b = _agentBatches[currentAgent][currentBatch];
            if (!b.hasParent) break;

            temp[depth] = BatchRef({ agentId: b.parentAgentId, batchIndex: b.parentBatchIndex });
            depth++;
            currentAgent = b.parentAgentId;
            currentBatch = b.parentBatchIndex;
        }

        chain = new BatchRef[](depth);
        for (uint256 i = 0; i < depth; i++) {
            chain[i] = temp[i];
        }
    }

    // ─────────────────────────────────────────────
    // Risk Score Read Functions
    // ─────────────────────────────────────────────

    /// @notice Get the full risk score details for a specific batch
    function getRiskScore(address agentId, uint256 batchIndex)
        external view returns (RiskScore memory)
    {
        require(batchIndex < _agentBatches[agentId].length, "AuditVault: batch not found");
        return _riskScores[agentId][batchIndex];
    }

    // ─────────────────────────────────────────────
    // Standard Read Functions
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
