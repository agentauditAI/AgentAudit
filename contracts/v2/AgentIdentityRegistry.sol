// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AgentRegistration.sol";

/// @title AgentIdentityRegistry
/// @notice ERC-8004 Agent Identity Standard — on-chain KYA (Know Your Agent) identity layer.
/// @dev    Extends AgentRegistration with structured identity: name, version, developer,
///         capabilities hash, and compliance level.
///         An identity can optionally be linked to an existing AgentRegistration entry;
///         if linked, the caller's address is cross-validated against the registration operator.
///         Works standalone (registrationId = 0) when AgentRegistration is not used.
contract AgentIdentityRegistry {

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    /// @notice ERC-8004 compliance tiers (mirrors AgentRegistration string levels as enum)
    enum ComplianceLevel { MINIMAL, LIMITED, HIGH, CRITICAL }

    /// @notice Full ERC-8004 on-chain agent identity
    struct AgentIdentity {
        string          name;             // human-readable name e.g. "TradingBot-v2"
        string          version;          // semver string e.g. "1.2.0"
        address         developer;        // developer wallet — only this address can update
        bytes32         capabilitiesHash; // keccak256 of the capabilities manifest (JSON or IPFS CID)
        ComplianceLevel complianceLevel;  // ERC-8004 compliance tier
        uint256         registrationId;   // AgentRegistration uint256 ID, 0 = standalone
        uint256         registeredAt;     // block.timestamp of initial registration
        uint256         updatedAt;        // block.timestamp of last capabilities update
        bool            active;           // false after revocation
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    /// @notice Linked AgentRegistration contract (cross-validates registrationId linkage)
    AgentRegistration public immutable agentRegistration;

    // agentAddress => identity
    mapping(address => AgentIdentity) private _identities;

    // agentAddress => registered flag
    mapping(address => bool) private _registered;

    // ordered list of all registered agent addresses (for iteration by EUAIActReporter)
    address[] private _agentList;

    uint256 public identityCount;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event AgentIdentityRegistered(
        address         indexed agentId,
        address         indexed developer,
        string          name,
        string          version,
        ComplianceLevel complianceLevel,
        uint256         registrationId,
        uint256         timestamp
    );

    /// @notice Emitted when an agent's capabilities manifest is updated.
    ///         previousHash lets auditors detect unexpected capability expansions.
    event CapabilitiesUpdated(
        address indexed agentId,
        bytes32 indexed newCapabilitiesHash,
        bytes32         previousHash,
        uint256         timestamp
    );

    event AgentIdentityRevoked(
        address indexed agentId,
        address indexed developer,
        uint256         timestamp
    );

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────

    modifier onlyDeveloper(address agentId) {
        require(
            _identities[agentId].developer == msg.sender,
            "AgentIdentityRegistry: not developer"
        );
        _;
    }

    modifier onlyRegistered(address agentId) {
        require(_registered[agentId], "AgentIdentityRegistry: not registered");
        _;
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    /// @param agentRegistrationAddr Address of the AgentRegistration contract.
    ///        Pass address(0) to deploy in standalone mode (no linkage validation).
    constructor(address agentRegistrationAddr) {
        agentRegistration = AgentRegistration(agentRegistrationAddr);
    }

    // ─────────────────────────────────────────────
    // Write Functions
    // ─────────────────────────────────────────────

    /// @notice Register an ERC-8004 identity for an AI agent.
    /// @param agentId          Address representing the agent (wallet or contract)
    /// @param name             Human-readable name e.g. "TradingBot-v2"
    /// @param version          Semver string e.g. "1.2.0"
    /// @param capabilitiesHash keccak256 of the capabilities manifest — hash off-chain, store hash on-chain
    /// @param complianceLevel  ERC-8004 compliance tier
    /// @param registrationId   AgentRegistration uint256 ID to link to, or 0 for standalone.
    ///                         If non-zero: msg.sender must be the operator of that registration entry.
    function registerAgentIdentity(
        address         agentId,
        string calldata name,
        string calldata version,
        bytes32         capabilitiesHash,
        ComplianceLevel complianceLevel,
        uint256         registrationId
    ) external {
        require(!_registered[agentId],                "AgentIdentityRegistry: already registered");
        require(bytes(name).length > 0,               "AgentIdentityRegistry: empty name");
        require(bytes(version).length > 0,            "AgentIdentityRegistry: empty version");
        require(capabilitiesHash != bytes32(0),        "AgentIdentityRegistry: empty capabilitiesHash");

        // Cross-validate against AgentRegistration if a registrationId is provided
        if (registrationId > 0) {
            require(
                address(agentRegistration) != address(0),
                "AgentIdentityRegistry: no AgentRegistration linked"
            );
            AgentRegistration.Agent memory reg = agentRegistration.getAgent(registrationId);
            require(reg.operator == msg.sender,  "AgentIdentityRegistry: caller is not registration operator");
            require(!reg.revoked,                "AgentIdentityRegistry: linked registration is revoked");
        }

        _identities[agentId] = AgentIdentity({
            name:             name,
            version:          version,
            developer:        msg.sender,
            capabilitiesHash: capabilitiesHash,
            complianceLevel:  complianceLevel,
            registrationId:   registrationId,
            registeredAt:     block.timestamp,
            updatedAt:        block.timestamp,
            active:           true
        });

        _registered[agentId] = true;
        _agentList.push(agentId);
        identityCount++;

        emit AgentIdentityRegistered(
            agentId, msg.sender, name, version, complianceLevel, registrationId, block.timestamp
        );
    }

    /// @notice Update the capabilities manifest hash for an agent.
    ///         Only the original developer can call this.
    ///         Emits CapabilitiesUpdated with the previous hash for audit trail continuity.
    /// @param agentId              Address of the agent
    /// @param newCapabilitiesHash  keccak256 of the new capabilities manifest
    function updateCapabilities(address agentId, bytes32 newCapabilitiesHash)
        external
        onlyRegistered(agentId)
        onlyDeveloper(agentId)
    {
        require(_identities[agentId].active,           "AgentIdentityRegistry: identity revoked");
        require(newCapabilitiesHash != bytes32(0),      "AgentIdentityRegistry: empty capabilitiesHash");
        require(
            newCapabilitiesHash != _identities[agentId].capabilitiesHash,
            "AgentIdentityRegistry: capabilities unchanged"
        );

        bytes32 previous = _identities[agentId].capabilitiesHash;
        _identities[agentId].capabilitiesHash = newCapabilitiesHash;
        _identities[agentId].updatedAt        = block.timestamp;

        emit CapabilitiesUpdated(agentId, newCapabilitiesHash, previous, block.timestamp);
    }

    /// @notice Revoke an agent identity — permanent, cannot be re-registered at the same address.
    ///         The identity record is preserved on-chain for audit purposes.
    function revokeIdentity(address agentId)
        external
        onlyRegistered(agentId)
        onlyDeveloper(agentId)
    {
        require(_identities[agentId].active, "AgentIdentityRegistry: already revoked");

        _identities[agentId].active    = false;
        _identities[agentId].updatedAt = block.timestamp;

        emit AgentIdentityRevoked(agentId, msg.sender, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // Read Functions
    // ─────────────────────────────────────────────

    /// @notice Get the full ERC-8004 identity for an agent.
    function getAgentIdentity(address agentId)
        external view onlyRegistered(agentId)
        returns (AgentIdentity memory)
    {
        return _identities[agentId];
    }

    /// @notice Returns all registered agent addresses — used by EUAIActReporter for iteration.
    function getRegisteredAgents() external view returns (address[] memory) {
        return _agentList;
    }

    /// @notice Returns true if an identity has been registered for this address.
    function isIdentityRegistered(address agentId) external view returns (bool) {
        return _registered[agentId];
    }

    /// @notice Returns true if the identity is registered and not revoked.
    function isActive(address agentId) external view returns (bool) {
        return _registered[agentId] && _identities[agentId].active;
    }

    /// @notice Get only the capabilities hash for an agent (cheap call for on-chain consumers).
    function getCapabilitiesHash(address agentId)
        external view onlyRegistered(agentId)
        returns (bytes32)
    {
        return _identities[agentId].capabilitiesHash;
    }

    /// @notice Get the compliance level for an agent.
    function getComplianceLevel(address agentId)
        external view onlyRegistered(agentId)
        returns (ComplianceLevel)
    {
        return _identities[agentId].complianceLevel;
    }
}
