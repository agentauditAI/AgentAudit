// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistration
 * @notice On-chain registry for AI agents — KYA (Know Your Agent) standard
 * @dev Issues Soulbound Tokens (SBT) as agent identity. Non-transferable.
 */
contract AgentRegistration {

    struct Agent {
        string name;
        address operator;
        uint256 createdAt;
        string complianceLevel;  // "minimal" | "limited" | "high"
        uint256 spendLimit;
        address auditVault;
        bool revoked;
    }

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256[]) public operatorAgents;
    uint256 public agentCount;

    event AgentRegistered(uint256 indexed agentId, address indexed operator, string name);
    event AgentRevoked(uint256 indexed agentId, address indexed operator);

    modifier onlyOperator(uint256 agentId) {
        require(agents[agentId].operator == msg.sender, "Not agent operator");
        _;
    }

    /**
     * @notice Register a new AI agent
     */
    function registerAgent(
        string calldata name,
        string calldata complianceLevel,
        uint256 spendLimit,
        address auditVault
    ) external returns (uint256 agentId) {
        agentId = ++agentCount;

        agents[agentId] = Agent({
            name: name,
            operator: msg.sender,
            createdAt: block.timestamp,
            complianceLevel: complianceLevel,
            spendLimit: spendLimit,
            auditVault: auditVault,
            revoked: false
        });

        operatorAgents[msg.sender].push(agentId);

        emit AgentRegistered(agentId, msg.sender, name);
    }

    /**
     * @notice Revoke an agent — logs remain permanently
     */
    function revokeAgent(uint256 agentId) external onlyOperator(agentId) {
        agents[agentId].revoked = true;
        emit AgentRevoked(agentId, msg.sender);
    }

    /**
     * @notice Get all agent IDs for an operator
     */
    function getOperatorAgents(address operator) external view returns (uint256[] memory) {
        return operatorAgents[operator];
    }

    /**
     * @notice Return the full Agent struct (public mapping getter can't return structs with strings)
     */
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    /**
     * @notice Check if agent is active (registered and not revoked)
     */
    function isActive(uint256 agentId) external view returns (bool) {
        return agentId <= agentCount && !agents[agentId].revoked;
    }
}