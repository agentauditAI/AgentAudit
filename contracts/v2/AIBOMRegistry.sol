// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AIBOMRegistry
/// @notice On-chain AI Bill of Materials registry — EU AI Act Article 11 + Annex IV
/// @dev CycloneDX 1.6 schema compatible
contract AIBOMRegistry {

    // ── Structs ──────────────────────────────────────────────────────────────

    struct AIBOM {
        bytes32 agentId;          // ERC-8004 agent identifier
        string  cycloneDXHash;    // IPFS/Arweave CID of full CycloneDX 1.6 JSON
        string  modelName;        // e.g. "gpt-4o", "claude-3-opus"
        string  modelVersion;
        string  datasetHash;      // hash of training dataset declaration
        address registeredBy;
        uint256 registeredAt;
        uint256 updatedAt;
        bool    active;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    mapping(bytes32 => AIBOM)   public aiboms;           // agentId => AIBOM
    mapping(bytes32 => bytes32[]) public aibomHistory;   // agentId => historical hashes
    bytes32[] public registeredAgents;

    address public owner;

    // ── Events ────────────────────────────────────────────────────────────────

    event AIBOMRegistered(bytes32 indexed agentId, string cycloneDXHash, address registeredBy, uint256 timestamp);
    event AIBOMUpdated(bytes32 indexed agentId, string newCycloneDXHash, uint256 timestamp);
    event AIBOMDeactivated(bytes32 indexed agentId, uint256 timestamp);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Functions ─────────────────────────────────────────────────────────────

    /// @notice Register a new AI BOM for an agent (Art. 11)
    function registerAIBOM(
        bytes32 agentId,
        string calldata cycloneDXHash,
        string calldata modelName,
        string calldata modelVersion,
        string calldata datasetHash
    ) external {
        require(agentId != bytes32(0), "Invalid agentId");
        require(bytes(cycloneDXHash).length > 0, "CycloneDX hash required");
        require(!aiboms[agentId].active, "AIBOM already registered");

        aiboms[agentId] = AIBOM({
            agentId: agentId,
            cycloneDXHash: cycloneDXHash,
            modelName: modelName,
            modelVersion: modelVersion,
            datasetHash: datasetHash,
            registeredBy: msg.sender,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            active: true
        });

        registeredAgents.push(agentId);
        emit AIBOMRegistered(agentId, cycloneDXHash, msg.sender, block.timestamp);
    }

    /// @notice Update CycloneDX hash (new version of BOM)
    function updateAIBOM(bytes32 agentId, string calldata newCycloneDXHash) external {
        require(aiboms[agentId].active, "AIBOM not found");
        require(aiboms[agentId].registeredBy == msg.sender || msg.sender == owner, "Not authorized");

        aibomHistory[agentId].push(keccak256(bytes(aiboms[agentId].cycloneDXHash)));
        aiboms[agentId].cycloneDXHash = newCycloneDXHash;
        aiboms[agentId].updatedAt = block.timestamp;

        emit AIBOMUpdated(agentId, newCycloneDXHash, block.timestamp);
    }

    /// @notice Deactivate AIBOM (agent retired)
    function deactivateAIBOM(bytes32 agentId) external {
        require(aiboms[agentId].active, "AIBOM not found");
        require(aiboms[agentId].registeredBy == msg.sender || msg.sender == owner, "Not authorized");

        aiboms[agentId].active = false;
        emit AIBOMDeactivated(agentId, block.timestamp);
    }

    /// @notice Get full AIBOM for an agent
    function getAIBOM(bytes32 agentId) external view returns (AIBOM memory) {
        return aiboms[agentId];
    }

    /// @notice Get count of registered agents
    function getRegisteredAgentsCount() external view returns (uint256) {
        return registeredAgents.length;
    }
}
