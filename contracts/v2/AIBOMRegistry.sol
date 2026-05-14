// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AIBOMRegistry
/// @notice On-chain AI Bill of Materials registry — EU AI Act Article 11 + Annex IV
/// @dev Stores content-addressed URIs (IPFS/Arweave) to full CycloneDX 1.6 JSON documents.
///      Raw BOM JSON never touches the chain; only the URI and key metadata fields are stored
///      so that on-chain records remain gas-efficient while remaining auditable.
/// @custom:article Art. 11 — Technical documentation obligations
/// @custom:article Annex IV — Technical documentation template
contract AIBOMRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev EU AI Act risk classification (Art. 6 + Annex III)
    enum RiskCategory { MINIMAL_RISK, LIMITED_RISK, HIGH_RISK, UNACCEPTABLE_RISK }

    /// @dev Input parameters for register() — avoids stack-too-deep on the 10-field call
    struct RegisterParams {
        bytes32      agentId;
        string       bomUri;          // IPFS/Arweave CID of CycloneDX 1.6 JSON
        string       serialNumber;    // CycloneDX serialNumber (urn:uuid format)
        string       modelName;
        string       modelVersion;
        string       intendedPurpose; // Annex IV §1
        string       supplierName;    // Art. 11
        RiskCategory riskCategory;
        string       datasetUri;      // Annex IV §2
        string       performanceUri;  // Annex IV §3
    }

    /// @dev Full BOM record. Annex IV fields are mapped to explicit struct members;
    ///      the complete CycloneDX 1.6 document lives at `bomUri`.
    struct AIBOM {
        bytes32      agentId;         // ERC-8004 agent identifier
        string       bomUri;          // IPFS/Arweave CID of full CycloneDX 1.6 JSON
        string       serialNumber;    // CycloneDX serialNumber (urn:uuid format)
        uint32       bomVersion;      // monotonic BOM version — increments on each update
        string       modelName;       // primary model name (e.g. "gpt-4o", "claude-3-opus")
        string       modelVersion;    // model release/version string
        string       intendedPurpose; // Annex IV §1 — intended purpose of the AI system
        string       supplierName;    // Art. 11 — provider / supplier name
        RiskCategory riskCategory;   // EU AI Act risk classification
        string       datasetUri;      // Annex IV §2 — training/validation dataset URI or hash
        string       performanceUri;  // Annex IV §3 — performance metrics document URI
        address      registeredBy;
        uint256      registeredAt;
        uint256      updatedAt;
        bool         active;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    mapping(bytes32 => AIBOM)      public  aiboms;
    mapping(bytes32 => bytes32[])  private _history;       // agentId => keccak256(old bomUri) list
    bytes32[]                      private _registeredAgents;
    mapping(bytes32 => bool)       private _exists;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AIBOMRegistered(
        bytes32 indexed  agentId,
        string           bomUri,
        string           serialNumber,
        RiskCategory     riskCategory,
        address          registeredBy,
        uint256          timestamp
    );

    event AIBOMUpdated(
        bytes32 indexed agentId,
        string          newBomUri,
        uint32          newVersion,
        uint256         timestamp
    );

    event AIBOMDeactivated(
        bytes32 indexed agentId,
        address         by,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error EmptyBomUri();
    error AlreadyRegistered(bytes32 agentId);
    error NotFound(bytes32 agentId);
    error NotActive(bytes32 agentId);
    error NotAuthorized(address caller);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /// @notice Register a new AI BOM (Art. 11 + Annex IV)
    /// @param p RegisterParams struct — all required BOM fields
    function register(RegisterParams calldata p) external {
        if (p.agentId == bytes32(0))       revert InvalidAgentId();
        if (bytes(p.bomUri).length == 0)   revert EmptyBomUri();
        if (_exists[p.agentId])            revert AlreadyRegistered(p.agentId);

        // Field-by-field assignment avoids large memory struct (stack-too-deep)
        AIBOM storage bom = aiboms[p.agentId];
        bom.agentId         = p.agentId;
        bom.bomUri          = p.bomUri;
        bom.serialNumber    = p.serialNumber;
        bom.bomVersion      = 1;
        bom.modelName       = p.modelName;
        bom.modelVersion    = p.modelVersion;
        bom.intendedPurpose = p.intendedPurpose;
        bom.supplierName    = p.supplierName;
        bom.riskCategory    = p.riskCategory;
        bom.datasetUri      = p.datasetUri;
        bom.performanceUri  = p.performanceUri;
        bom.registeredBy    = msg.sender;
        bom.registeredAt    = block.timestamp;
        bom.updatedAt       = block.timestamp;
        bom.active          = true;

        _exists[p.agentId] = true;
        _registeredAgents.push(p.agentId);

        emit AIBOMRegistered(p.agentId, p.bomUri, p.serialNumber, p.riskCategory, msg.sender, block.timestamp);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// @notice Update the BOM URI (new CycloneDX version) — Annex IV lifecycle change tracking
    /// @dev Archives the hash of the previous URI in `_history` for immutable audit trail
    function update(bytes32 agentId, string calldata newBomUri) external {
        if (!_exists[agentId])                    revert NotFound(agentId);
        if (!aiboms[agentId].active)              revert NotActive(agentId);
        if (!_isAuthorized(agentId, msg.sender))  revert NotAuthorized(msg.sender);

        _history[agentId].push(keccak256(bytes(aiboms[agentId].bomUri)));

        AIBOM storage bom = aiboms[agentId];
        bom.bomUri    = newBomUri;
        bom.bomVersion++;
        bom.updatedAt = block.timestamp;

        emit AIBOMUpdated(agentId, newBomUri, bom.bomVersion, block.timestamp);
    }

    /// @notice Deactivate a BOM record (agent retired or deprecated)
    function deactivate(bytes32 agentId) external {
        if (!_exists[agentId])                   revert NotFound(agentId);
        if (!aiboms[agentId].active)             revert NotActive(agentId);
        if (!_isAuthorized(agentId, msg.sender)) revert NotAuthorized(msg.sender);

        aiboms[agentId].active    = false;
        aiboms[agentId].updatedAt = block.timestamp;

        emit AIBOMDeactivated(agentId, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get the full AIBOM record for an agent
    function getAIBOM(bytes32 agentId) external view returns (AIBOM memory) {
        if (!_exists[agentId]) revert NotFound(agentId);
        return aiboms[agentId];
    }

    /// @notice Get the keccak256 hashes of previous BOM URIs (audit history)
    function getHistory(bytes32 agentId) external view returns (bytes32[] memory) {
        if (!_exists[agentId]) revert NotFound(agentId);
        return _history[agentId];
    }

    /// @notice Get the total number of registered agents
    function getRegisteredCount() external view returns (uint256) {
        return _registeredAgents.length;
    }

    /// @notice Get all registered agent IDs
    function getRegisteredAgents() external view returns (bytes32[] memory) {
        return _registeredAgents;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _isAuthorized(bytes32 agentId, address caller) internal view returns (bool) {
        return aiboms[agentId].registeredBy == caller || caller == deployer;
    }
}
