// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentIdentityRegistry
/// @notice ERC-8004 Trustless Agents identity registry
/// @dev EU AI Act Art. 13 (transparency) + Art. 26 (deployer obligations)
contract AgentIdentityRegistry {

    enum AgentStatus { INACTIVE, ACTIVE, SUSPENDED, REVOKED }

    struct AgentIdentity {
        bytes32 agentId;
        address owner;
        address operator;
        string  name;
        string  version;
        string  modelType;
        string  purposeHash;     // IPFS CID of purpose declaration
        AgentStatus status;
        uint256 registeredAt;
        uint256 updatedAt;
        bool    highRisk;        // EU AI Act Annex III
    }

    mapping(bytes32 => AgentIdentity) public agents;
    mapping(address => bytes32[]) public ownerAgents;
    bytes32[] public allAgents;

    address public owner;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, string name, uint256 timestamp);
    event AgentUpdated(bytes32 indexed agentId, AgentStatus status, uint256 timestamp);
    event AgentRevoked(bytes32 indexed agentId, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAgentOwner(bytes32 agentId) {
        require(agents[agentId].owner == msg.sender || msg.sender == owner, "Not authorized");
        _;
    }

    constructor() { owner = msg.sender; }

    function registerAgent(
        bytes32 agentId,
        address operator,
        string calldata name,
        string calldata version,
        string calldata modelType,
        string calldata purposeHash,
        bool highRisk
    ) external returns (bytes32) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(agents[agentId].registeredAt == 0, "Agent already registered");
        require(bytes(name).length > 0, "Name required");

        agents[agentId] = AgentIdentity({
            agentId: agentId,
            owner: msg.sender,
            operator: operator,
            name: name,
            version: version,
            modelType: modelType,
            purposeHash: purposeHash,
            status: AgentStatus.ACTIVE,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            highRisk: highRisk
        });

        ownerAgents[msg.sender].push(agentId);
        allAgents.push(agentId);
        emit AgentRegistered(agentId, msg.sender, name, block.timestamp);
        return agentId;
    }

    function updateStatus(bytes32 agentId, AgentStatus status) external onlyAgentOwner(agentId) {
        require(agents[agentId].registeredAt != 0, "Agent not found");
        require(agents[agentId].status != AgentStatus.REVOKED, "Cannot update revoked agent");
        agents[agentId].status = status;
        agents[agentId].updatedAt = block.timestamp;
        emit AgentUpdated(agentId, status, block.timestamp);
    }

    function revokeAgent(bytes32 agentId) external onlyAgentOwner(agentId) {
        require(agents[agentId].registeredAt != 0, "Agent not found");
        agents[agentId].status = AgentStatus.REVOKED;
        agents[agentId].updatedAt = block.timestamp;
        emit AgentRevoked(agentId, block.timestamp);
    }

    function isActive(bytes32 agentId) external view returns (bool) {
        return agents[agentId].status == AgentStatus.ACTIVE;
    }

    function getAgent(bytes32 agentId) external view returns (AgentIdentity memory) {
        return agents[agentId];
    }

    function getOwnerAgents(address _owner) external view returns (bytes32[] memory) {
        return ownerAgents[_owner];
    }

    function getTotalAgents() external view returns (uint256) {
        return allAgents.length;
    }
}