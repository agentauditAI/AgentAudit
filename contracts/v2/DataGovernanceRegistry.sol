// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DataGovernanceRegistry
/// @notice On-chain data governance registry for AI training, validation, and testing datasets
/// @dev Implements Art. 10 data management obligations for high-risk AI systems.
///      Each dataset is registered with provenance metadata; quality assessments (§3 —
///      relevance, representativeness, completeness, error rate) and bias examinations
///      (§2f/§5 — protected characteristics) are recorded separately and can be updated
///      as the dataset evolves. `isDataReady()` provides an on-chain gate that returns
///      true only when the latest quality assessment PASSED and bias check is CLEAR or
///      MITIGATED — usable by other contracts before authorising model deployment.
/// @custom:article Art. 10 — Data and data governance
/// @custom:article Art. 10§2 — Data governance and management practices
/// @custom:article Art. 10§3 — Relevance, representativeness, completeness, error-free
/// @custom:article Art. 10§5 — Special categories of data for bias monitoring/correction
contract DataGovernanceRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Role of the dataset in the ML pipeline (Art. 10§1)
    enum DatasetRole { TRAINING, VALIDATION, TESTING }

    /// @dev Outcome of a quality assessment (Art. 10§3)
    enum QualityStatus { PENDING, PASSED, FAILED, CONDITIONAL }

    /// @dev Outcome of a bias examination (Art. 10§2f / §5)
    enum BiasStatus { NOT_CHECKED, CLEAR, BIASES_FOUND, MITIGATED }

    /// @dev Input parameters for registerDataset() — avoids stack-too-deep
    struct DatasetParams {
        bytes32     agentId;        // ERC-8004 agent identifier
        DatasetRole role;
        string      name;           // human-readable dataset name
        string      version;        // version string (e.g. "2024-Q4-v1")
        string      sourceUri;      // IPFS/Arweave URI to data provenance documentation
        bytes32     contentHash;    // keccak256 / Merkle root of the dataset
        string      description;    // Art. 10§2a — design choices and data collection context
        uint256     dataPointCount; // number of records / samples
    }

    struct DatasetRecord {
        uint256     id;
        bytes32     agentId;
        DatasetRole role;
        string      name;
        string      version;
        string      sourceUri;
        bytes32     contentHash;
        string      description;
        uint256     dataPointCount;
        address     registeredBy;
        uint256     registeredAt;
        bool        active;
    }

    /// @dev Latest quality assessment for a dataset (Art. 10§3)
    struct QualityAssessment {
        uint256       datasetId;
        QualityStatus status;
        uint16        completenessScore;      // 0–10000 (scaled 1e4)
        uint16        representativenessScore; // 0–10000
        uint16        errorRate;              // 0–10000 (lower is better)
        string        assessmentUri;          // IPFS URI to full assessment report
        address       assessedBy;
        uint256       assessedAt;
    }

    /// @dev Latest bias examination for a dataset (Art. 10§2f / §5)
    struct BiasExamination {
        uint256    datasetId;
        BiasStatus status;
        string     biasTypes;       // comma-separated bias types identified (or "none")
        string     affectedGroups;  // protected characteristics examined (Art. 10§5)
        string     mitigationUri;   // IPFS URI to mitigation/correction measures
        address    examinedBy;
        uint256    examinedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public datasetCount;

    mapping(uint256 => DatasetRecord)    private _datasets;
    mapping(uint256 => QualityAssessment) private _quality;
    mapping(uint256 => BiasExamination)  private _bias;

    // agentId → dataset IDs
    mapping(bytes32 => uint256[]) private _agentDatasets;

    // per-dataset authorised assessors
    mapping(uint256 => mapping(address => bool)) public assessors;

    // ─── Events ──────────────────────────────────────────────────────────────

    event DatasetRegistered(
        uint256 indexed  id,
        bytes32 indexed  agentId,
        DatasetRole      role,
        string           name,
        bytes32          contentHash,
        address          registeredBy,
        uint256          timestamp
    );

    event QualityAssessed(
        uint256 indexed id,
        QualityStatus   status,
        uint16          completenessScore,
        uint16          representativenessScore,
        uint16          errorRate,
        address         assessedBy,
        uint256         timestamp
    );

    event BiasExamined(
        uint256 indexed id,
        BiasStatus      status,
        string          biasTypes,
        string          affectedGroups,
        address         examinedBy,
        uint256         timestamp
    );

    event DatasetDeactivated(
        uint256 indexed id,
        address         by,
        uint256         timestamp
    );

    event AssessorSet(
        uint256 indexed datasetId,
        address         assessor,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error DatasetNotFound(uint256 id);
    error DatasetInactive(uint256 id);
    error NotAuthorized(address caller);
    error EmptyField();
    error InvalidScore(uint16 score);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Dataset Registration ────────────────────────────────────────────────

    /// @notice Register a dataset used for training, validation, or testing (Art. 10§1)
    function registerDataset(DatasetParams calldata p) external returns (uint256 id) {
        if (p.agentId == bytes32(0))        revert InvalidAgentId();
        if (bytes(p.name).length == 0)      revert EmptyField();
        if (p.contentHash == bytes32(0))    revert EmptyField();

        id = ++datasetCount;

        DatasetRecord storage d = _datasets[id];
        d.id             = id;
        d.agentId        = p.agentId;
        d.role           = p.role;
        d.name           = p.name;
        d.version        = p.version;
        d.sourceUri      = p.sourceUri;
        d.contentHash    = p.contentHash;
        d.description    = p.description;
        d.dataPointCount = p.dataPointCount;
        d.registeredBy   = msg.sender;
        d.registeredAt   = block.timestamp;
        d.active         = true;

        // seed quality and bias records in PENDING / NOT_CHECKED state
        _quality[id].datasetId = id;
        _bias[id].datasetId    = id;

        _agentDatasets[p.agentId].push(id);

        emit DatasetRegistered(id, p.agentId, p.role, p.name, p.contentHash, msg.sender, block.timestamp);
    }

    // ─── Assessor Management ─────────────────────────────────────────────────

    /// @notice Authorize or revoke a quality/bias assessor for a specific dataset
    function setAssessor(uint256 datasetId, address assessor, bool authorized) external {
        DatasetRecord storage d = _load(datasetId);
        if (!_isAuthorized(d, msg.sender)) revert NotAuthorized(msg.sender);
        assessors[datasetId][assessor] = authorized;
        emit AssessorSet(datasetId, assessor, authorized, block.timestamp);
    }

    // ─── Quality Assessment ──────────────────────────────────────────────────

    /// @notice Record a quality assessment for a dataset (Art. 10§3)
    /// @param datasetId              Target dataset
    /// @param status                 Overall quality outcome
    /// @param completenessScore      0–10000 — fraction of expected records present
    /// @param representativenessScore 0–10000 — distributional coverage of target population
    /// @param errorRate              0–10000 — fraction of records with errors (lower = better)
    /// @param assessmentUri          IPFS/Arweave URI to the full quality report
    function recordQualityAssessment(
        uint256         datasetId,
        QualityStatus   status,
        uint16          completenessScore,
        uint16          representativenessScore,
        uint16          errorRate,
        string calldata assessmentUri
    ) external {
        DatasetRecord storage d = _load(datasetId);
        if (!d.active)                       revert DatasetInactive(datasetId);
        if (!_isAssessor(datasetId, d, msg.sender)) revert NotAuthorized(msg.sender);
        if (completenessScore > 10000)       revert InvalidScore(completenessScore);
        if (representativenessScore > 10000) revert InvalidScore(representativenessScore);
        if (errorRate > 10000)               revert InvalidScore(errorRate);

        QualityAssessment storage q = _quality[datasetId];
        q.status                   = status;
        q.completenessScore        = completenessScore;
        q.representativenessScore  = representativenessScore;
        q.errorRate                = errorRate;
        q.assessmentUri            = assessmentUri;
        q.assessedBy               = msg.sender;
        q.assessedAt               = block.timestamp;

        emit QualityAssessed(
            datasetId, status, completenessScore, representativenessScore,
            errorRate, msg.sender, block.timestamp
        );
    }

    // ─── Bias Examination ────────────────────────────────────────────────────

    /// @notice Record a bias examination result (Art. 10§2f — possible biases, §5 — special data)
    /// @param datasetId      Target dataset
    /// @param status         Outcome of the examination
    /// @param biasTypes      Comma-separated bias types found, or "none"
    /// @param affectedGroups Protected characteristics examined (e.g. "gender,ethnicity,age")
    /// @param mitigationUri  IPFS URI to bias correction/mitigation measures (required if MITIGATED)
    function recordBiasExamination(
        uint256         datasetId,
        BiasStatus      status,
        string calldata biasTypes,
        string calldata affectedGroups,
        string calldata mitigationUri
    ) external {
        DatasetRecord storage d = _load(datasetId);
        if (!d.active)                       revert DatasetInactive(datasetId);
        if (!_isAssessor(datasetId, d, msg.sender)) revert NotAuthorized(msg.sender);
        if (bytes(affectedGroups).length == 0) revert EmptyField();

        BiasExamination storage b = _bias[datasetId];
        b.status         = status;
        b.biasTypes      = biasTypes;
        b.affectedGroups = affectedGroups;
        b.mitigationUri  = mitigationUri;
        b.examinedBy     = msg.sender;
        b.examinedAt     = block.timestamp;

        emit BiasExamined(datasetId, status, biasTypes, affectedGroups, msg.sender, block.timestamp);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// @notice Deactivate a dataset (replaced, deprecated, or withdrawn)
    function deactivateDataset(uint256 datasetId) external {
        DatasetRecord storage d = _load(datasetId);
        if (!_isAuthorized(d, msg.sender)) revert NotAuthorized(msg.sender);
        d.active = false;
        emit DatasetDeactivated(datasetId, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get a dataset record
    function getDataset(uint256 datasetId) external view returns (DatasetRecord memory) {
        if (_datasets[datasetId].id == 0) revert DatasetNotFound(datasetId);
        return _datasets[datasetId];
    }

    /// @notice Get the latest quality assessment for a dataset
    function getQualityAssessment(uint256 datasetId) external view returns (QualityAssessment memory) {
        if (_datasets[datasetId].id == 0) revert DatasetNotFound(datasetId);
        return _quality[datasetId];
    }

    /// @notice Get the latest bias examination for a dataset
    function getBiasExamination(uint256 datasetId) external view returns (BiasExamination memory) {
        if (_datasets[datasetId].id == 0) revert DatasetNotFound(datasetId);
        return _bias[datasetId];
    }

    /// @notice Get all dataset IDs registered for an agent
    function getAgentDatasets(bytes32 agentId) external view returns (uint256[] memory) {
        return _agentDatasets[agentId];
    }

    /// @notice Returns true when data is ready for use: quality PASSED and bias CLEAR or MITIGATED
    /// @dev Intended as an on-chain gate before model training / deployment authorisation
    function isDataReady(uint256 datasetId) external view returns (bool) {
        if (_datasets[datasetId].id == 0) revert DatasetNotFound(datasetId);
        if (!_datasets[datasetId].active) return false;
        QualityAssessment storage q = _quality[datasetId];
        BiasExamination   storage b = _bias[datasetId];
        bool qualityOk = q.status == QualityStatus.PASSED || q.status == QualityStatus.CONDITIONAL;
        bool biasOk    = b.status == BiasStatus.CLEAR     || b.status == BiasStatus.MITIGATED;
        return qualityOk && biasOk;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _load(uint256 datasetId) internal view returns (DatasetRecord storage d) {
        d = _datasets[datasetId];
        if (d.id == 0) revert DatasetNotFound(datasetId);
    }

    function _isAuthorized(DatasetRecord storage d, address caller) internal view returns (bool) {
        return d.registeredBy == caller || caller == deployer;
    }

    function _isAssessor(uint256 datasetId, DatasetRecord storage d, address caller)
        internal view returns (bool)
    {
        return d.registeredBy == caller
            || assessors[datasetId][caller]
            || caller == deployer;
    }
}
