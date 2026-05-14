// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GPAIModelRegistry
/// @notice On-chain registry for General Purpose AI (GPAI) model obligations — EU AI Act Art. 53
/// @dev Providers of GPAI models must: draw up technical documentation (§1a), provide information
///      to downstream providers (§1b), establish a copyright compliance policy (§1c), and publish
///      a summary of training data (§1d). Open-source GPAI models qualifying under Art. 53§2 may
///      claim exemptions from §1a/§1b while still requiring a copyright policy and training summary.
///      Each model is registered once; documentation URIs can be updated. `isArt53Compliant()`
///      returns true when all mandatory URIs are present and the model is ACTIVE.
/// @custom:article Art. 53 — Obligations of providers of GPAI models
/// @custom:article Art. 53§1 — Mandatory documentation, copyright policy, training data summary
/// @custom:article Art. 53§2 — Open-source model reduced obligations
/// @custom:article Art. 51 — Classification of GPAI models with systemic risk
contract GPAIModelRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Lifecycle status of a GPAI model registration
    enum ModelStatus { REGISTERED, ACTIVE, DEPRECATED }

    /// @dev Input parameters for registerModel() — avoids stack-too-deep
    struct RegisterParams {
        bytes32 modelId;           // unique model identifier (ERC-8004 or keccak256 of name+version)
        string  name;              // human-readable model name
        string  version;           // version string
        string  provider;          // provider organisation name
        bool    isOpenSource;      // true → Art. 53§2 exemptions may apply
        bool    hasSystemicRisk;   // true → also subject to Art. 55
        string  technicalDocUri;   // IPFS/Arweave URI to technical documentation (§1a)
        string  copyrightPolicyUri; // IPFS/Arweave URI to copyright compliance policy (§1c)
        string  trainingDataSummaryUri; // IPFS/Arweave URI to training data summary (§1d)
        string  downstreamInfoUri; // IPFS/Arweave URI to downstream-provider info (§1b); empty for open-source
        uint64  parameterCountM;   // parameter count in millions (0 = undisclosed)
    }

    struct GPAIModel {
        bytes32     modelId;
        string      name;
        string      version;
        string      provider;
        bool        isOpenSource;
        bool        hasSystemicRisk;
        ModelStatus status;
        string      technicalDocUri;
        string      copyrightPolicyUri;
        string      trainingDataSummaryUri;
        string      downstreamInfoUri;
        uint64      parameterCountM;
        address     registeredBy;
        uint256     registeredAt;
        uint256     updatedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public modelCount;

    mapping(bytes32 => GPAIModel) private _models;
    mapping(bytes32 => bool)      private _exists;
    bytes32[]                     private _modelIds;

    // per-model authorised updaters
    mapping(bytes32 => mapping(address => bool)) public updaters;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ModelRegistered(
        bytes32 indexed modelId,
        string          name,
        string          version,
        bool            isOpenSource,
        bool            hasSystemicRisk,
        address         registeredBy,
        uint256         timestamp
    );

    event ModelActivated(
        bytes32 indexed modelId,
        address         by,
        uint256         timestamp
    );

    event ModelDeprecated(
        bytes32 indexed modelId,
        address         by,
        uint256         timestamp
    );

    event DocumentationUpdated(
        bytes32 indexed modelId,
        string          field,         // "technicalDoc" | "copyrightPolicy" | "trainingDataSummary" | "downstreamInfo"
        string          newUri,
        address         by,
        uint256         timestamp
    );

    event SystemicRiskFlagChanged(
        bytes32 indexed modelId,
        bool            hasSystemicRisk,
        address         by,
        uint256         timestamp
    );

    event UpdaterSet(
        bytes32 indexed modelId,
        address         updater,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidModelId();
    error AlreadyRegistered(bytes32 modelId);
    error ModelNotFound(bytes32 modelId);
    error NotAuthorized(address caller);
    error EmptyField();
    error AlreadyDeprecated(bytes32 modelId);
    error InvalidStatus(ModelStatus current);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /// @notice Register a GPAI model and its Art. 53§1 documentation (Art. 53)
    /// @dev Non-open-source models must supply all four URIs. Open-source models may omit
    ///      downstreamInfoUri (§1b exemption under Art. 53§2), but must still provide
    ///      copyrightPolicyUri (§1c) and trainingDataSummaryUri (§1d).
    function registerModel(RegisterParams calldata p) external returns (bytes32 modelId) {
        if (p.modelId == bytes32(0))                     revert InvalidModelId();
        if (_exists[p.modelId])                          revert AlreadyRegistered(p.modelId);
        if (bytes(p.name).length == 0)                   revert EmptyField();
        if (bytes(p.copyrightPolicyUri).length == 0)     revert EmptyField();
        if (bytes(p.trainingDataSummaryUri).length == 0) revert EmptyField();
        // non-open-source must supply technical doc and downstream info (§1a, §1b)
        if (!p.isOpenSource) {
            if (bytes(p.technicalDocUri).length == 0)    revert EmptyField();
            if (bytes(p.downstreamInfoUri).length == 0)  revert EmptyField();
        }

        modelId = p.modelId;
        GPAIModel storage m = _models[modelId];
        m.modelId                  = modelId;
        m.name                     = p.name;
        m.version                  = p.version;
        m.provider                 = p.provider;
        m.isOpenSource             = p.isOpenSource;
        m.hasSystemicRisk          = p.hasSystemicRisk;
        m.status                   = ModelStatus.REGISTERED;
        m.technicalDocUri          = p.technicalDocUri;
        m.copyrightPolicyUri       = p.copyrightPolicyUri;
        m.trainingDataSummaryUri   = p.trainingDataSummaryUri;
        m.downstreamInfoUri        = p.downstreamInfoUri;
        m.parameterCountM          = p.parameterCountM;
        m.registeredBy             = msg.sender;
        m.registeredAt             = block.timestamp;
        m.updatedAt                = block.timestamp;

        _exists[p.modelId] = true;
        _modelIds.push(modelId);
        modelCount++;

        emit ModelRegistered(modelId, p.name, p.version, p.isOpenSource, p.hasSystemicRisk, msg.sender, block.timestamp);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// @notice Activate the model — provider formally deploys it for downstream use
    function activate(bytes32 modelId) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        if (m.status == ModelStatus.ACTIVE)         revert InvalidStatus(m.status);
        m.status    = ModelStatus.ACTIVE;
        m.updatedAt = block.timestamp;
        emit ModelActivated(modelId, msg.sender, block.timestamp);
    }

    /// @notice Deprecate the model — provider retires it from active use
    function deprecate(bytes32 modelId) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        m.status    = ModelStatus.DEPRECATED;
        m.updatedAt = block.timestamp;
        emit ModelDeprecated(modelId, msg.sender, block.timestamp);
    }

    // ─── Documentation Updates ───────────────────────────────────────────────

    /// @notice Update the technical documentation URI (Art. 53§1a)
    function updateTechnicalDoc(bytes32 modelId, string calldata uri) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        if (bytes(uri).length == 0)                 revert EmptyField();
        m.technicalDocUri = uri;
        m.updatedAt       = block.timestamp;
        emit DocumentationUpdated(modelId, "technicalDoc", uri, msg.sender, block.timestamp);
    }

    /// @notice Update the copyright compliance policy URI (Art. 53§1c)
    function updateCopyrightPolicy(bytes32 modelId, string calldata uri) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        if (bytes(uri).length == 0)                 revert EmptyField();
        m.copyrightPolicyUri = uri;
        m.updatedAt          = block.timestamp;
        emit DocumentationUpdated(modelId, "copyrightPolicy", uri, msg.sender, block.timestamp);
    }

    /// @notice Update the training data summary URI (Art. 53§1d)
    function updateTrainingDataSummary(bytes32 modelId, string calldata uri) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        if (bytes(uri).length == 0)                 revert EmptyField();
        m.trainingDataSummaryUri = uri;
        m.updatedAt              = block.timestamp;
        emit DocumentationUpdated(modelId, "trainingDataSummary", uri, msg.sender, block.timestamp);
    }

    /// @notice Update the downstream-provider information URI (Art. 53§1b)
    function updateDownstreamInfo(bytes32 modelId, string calldata uri) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        if (bytes(uri).length == 0)                 revert EmptyField();
        m.downstreamInfoUri = uri;
        m.updatedAt         = block.timestamp;
        emit DocumentationUpdated(modelId, "downstreamInfo", uri, msg.sender, block.timestamp);
    }

    /// @notice Flag or unflag a model as having systemic risk (Art. 51)
    function setSystemicRisk(bytes32 modelId, bool flag) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        if (m.status == ModelStatus.DEPRECATED)     revert AlreadyDeprecated(modelId);
        m.hasSystemicRisk = flag;
        m.updatedAt       = block.timestamp;
        emit SystemicRiskFlagChanged(modelId, flag, msg.sender, block.timestamp);
    }

    // ─── Updater Management ───────────────────────────────────────────────────

    /// @notice Authorize or revoke an updater for a model
    function setUpdater(bytes32 modelId, address updater, bool authorized) external {
        GPAIModel storage m = _load(modelId);
        if (!_isAuthorized(modelId, m, msg.sender)) revert NotAuthorized(msg.sender);
        updaters[modelId][updater] = authorized;
        emit UpdaterSet(modelId, updater, authorized, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get a GPAI model record
    function getModel(bytes32 modelId) external view returns (GPAIModel memory) {
        if (!_exists[modelId]) revert ModelNotFound(modelId);
        return _models[modelId];
    }

    /// @notice Get all registered model IDs
    function getModelIds() external view returns (bytes32[] memory) {
        return _modelIds;
    }

    /// @notice Returns true when the model is ACTIVE and all Art. 53§1 mandatory URIs are present
    /// @dev Open-source models: copyrightPolicy + trainingDataSummary required.
    ///      Closed-source: all four URIs required.
    function isArt53Compliant(bytes32 modelId) external view returns (bool) {
        if (!_exists[modelId]) return false;
        GPAIModel storage m = _models[modelId];
        if (m.status != ModelStatus.ACTIVE) return false;
        if (bytes(m.copyrightPolicyUri).length == 0)     return false;
        if (bytes(m.trainingDataSummaryUri).length == 0) return false;
        if (!m.isOpenSource) {
            if (bytes(m.technicalDocUri).length == 0)    return false;
            if (bytes(m.downstreamInfoUri).length == 0)  return false;
        }
        return true;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _load(bytes32 modelId) internal view returns (GPAIModel storage m) {
        if (!_exists[modelId]) revert ModelNotFound(modelId);
        m = _models[modelId];
    }

    function _isAuthorized(bytes32 modelId, GPAIModel storage m, address caller)
        internal view returns (bool)
    {
        return m.registeredBy == caller
            || updaters[modelId][caller]
            || caller == deployer;
    }
}
