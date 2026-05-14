// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SystemicRiskRegistry
/// @notice On-chain registry for GPAI systemic risk obligations — EU AI Act Art. 55
/// @dev Providers of GPAI models with systemic risk must: (§1a) perform adversarial testing
///      (model evaluation) per AI Office guidelines; (§1b) report serious incidents to the
///      AI Office and cooperate on mitigation; (§1c) implement and document cybersecurity
///      protections; (§1d) report on energy consumption and environmental impact. This
///      contract records all four obligation categories and exposes `isArt55Compliant()` as
///      an on-chain gate requiring all four to be addressed for a given model.
/// @custom:article Art. 55 — Obligations of providers of GPAI models with systemic risk
/// @custom:article Art. 55§1a — Adversarial testing (model evaluation)
/// @custom:article Art. 55§1b — AI Office incident reporting
/// @custom:article Art. 55§1c — Cybersecurity protections
/// @custom:article Art. 55§1d — Energy consumption reporting
contract SystemicRiskRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Outcome of an adversarial (red-team) evaluation per Art. 55§1a
    enum EvaluationOutcome { PASS, CONDITIONAL_PASS, FAIL }

    /// @dev Severity of an AI Office incident report per Art. 55§1b
    enum IncidentSeverity { LOW, MEDIUM, HIGH, CRITICAL }

    /// @dev Status of an AI Office incident report
    enum IncidentStatus { REPORTED, UNDER_REVIEW, RESOLVED }

    /// @dev Art. 55§1a — Adversarial / red-team evaluation record
    struct AdversarialEvaluation {
        uint256          id;
        bytes32          modelId;
        string           methodology;      // evaluation framework (e.g. "MITRE ATLAS", "NIST AI RMF")
        string           findings;         // human-readable summary
        EvaluationOutcome outcome;
        string           reportUri;        // IPFS/Arweave URI to full report
        address          evaluatedBy;
        uint256          evaluatedAt;
    }

    /// @dev Art. 55§1b — Serious incident report to the AI Office
    struct AIOfficeIncident {
        uint256          id;
        bytes32          modelId;
        IncidentSeverity severity;
        IncidentStatus   status;
        string           description;
        string           reportUri;        // IPFS/Arweave URI to the formal report
        uint256          occurredAt;
        address          reportedBy;
        uint256          reportedAt;
        string           resolutionUri;    // populated on resolution
    }

    /// @dev Art. 55§1c — Cybersecurity protection record (latest per model)
    struct CybersecurityProtection {
        bytes32 modelId;
        string  measuresUri;      // IPFS/Arweave URI to cybersecurity measures document
        string  threatModel;      // brief description of threat model addressed
        bool    pentestPerformed;
        string  pentestUri;       // IPFS/Arweave URI to pentest report (if performed)
        address recordedBy;
        uint256 recordedAt;
    }

    /// @dev Art. 55§1d — Energy consumption and environmental impact report
    struct EnergyReport {
        bytes32 modelId;
        uint256 trainingEnergyKwh;         // energy used for training
        uint256 inferenceEnergyKwhPer1M;   // energy per 1 million inference requests
        string  methodologyUri;            // IPFS/Arweave URI to measurement methodology
        string  reportUri;                 // IPFS/Arweave URI to full energy report
        address reportedBy;
        uint256 reportedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public evaluationCount;
    uint256 public incidentCount;

    mapping(uint256 => AdversarialEvaluation) private _evaluations;
    mapping(bytes32  => uint256[])            private _modelEvaluations;

    mapping(uint256 => AIOfficeIncident)      private _incidents;
    mapping(bytes32  => uint256[])            private _modelIncidents;

    mapping(bytes32 => CybersecurityProtection) private _cybersecurity;
    mapping(bytes32 => bool)                    private _hasCybersecurity;

    mapping(bytes32 => EnergyReport)          private _energy;
    mapping(bytes32 => bool)                  private _hasEnergy;

    // per-model authorised reporters
    mapping(bytes32 => address)                       public modelOwner;
    mapping(bytes32 => mapping(address => bool))      public reporters;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ModelOwnerSet(
        bytes32 indexed modelId,
        address         owner,
        uint256         timestamp
    );

    event AdversarialEvaluationRecorded(
        uint256 indexed   id,
        bytes32 indexed   modelId,
        EvaluationOutcome outcome,
        address           evaluatedBy,
        uint256           timestamp
    );

    event AIOfficeIncidentReported(
        uint256 indexed  id,
        bytes32 indexed  modelId,
        IncidentSeverity severity,
        address          reportedBy,
        uint256          timestamp
    );

    event AIOfficeIncidentResolved(
        uint256 indexed id,
        string          resolutionUri,
        address         by,
        uint256         timestamp
    );

    event CybersecurityProtectionRecorded(
        bytes32 indexed modelId,
        bool            pentestPerformed,
        address         recordedBy,
        uint256         timestamp
    );

    event EnergyReportRecorded(
        bytes32 indexed modelId,
        uint256         trainingEnergyKwh,
        uint256         inferenceEnergyKwhPer1M,
        address         reportedBy,
        uint256         timestamp
    );

    event ReporterSet(
        bytes32 indexed modelId,
        address         reporter,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidModelId();
    error ModelAlreadyClaimed(bytes32 modelId);
    error NotAuthorized(address caller);
    error EvaluationNotFound(uint256 id);
    error IncidentNotFound(uint256 id);
    error IncidentAlreadyResolved(uint256 id);
    error EmptyField();
    error FutureTimestamp(uint256 provided, uint256 current);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Model Ownership ─────────────────────────────────────────────────────

    /// @notice Claim ownership of a model record for this registry
    function claimModel(bytes32 modelId) external {
        if (modelId == bytes32(0))               revert InvalidModelId();
        if (modelOwner[modelId] != address(0))   revert ModelAlreadyClaimed(modelId);
        modelOwner[modelId] = msg.sender;
        emit ModelOwnerSet(modelId, msg.sender, block.timestamp);
    }

    /// @notice Authorize or revoke a reporter for a model
    function setReporter(bytes32 modelId, address reporter, bool authorized) external {
        if (!_isOwner(modelId, msg.sender)) revert NotAuthorized(msg.sender);
        reporters[modelId][reporter] = authorized;
        emit ReporterSet(modelId, reporter, authorized, block.timestamp);
    }

    // ─── Art. 55§1a — Adversarial Evaluations ────────────────────────────────

    /// @notice Record an adversarial (red-team) evaluation result (Art. 55§1a)
    /// @param modelId     GPAI model identifier (must match GPAIModelRegistry)
    /// @param methodology Evaluation framework name (e.g. "MITRE ATLAS", "NIST AI RMF")
    /// @param findings    Human-readable summary of findings
    /// @param outcome     Overall outcome of the evaluation
    /// @param reportUri   IPFS/Arweave URI to the full evaluation report
    function recordEvaluation(
        bytes32           modelId,
        string calldata   methodology,
        string calldata   findings,
        EvaluationOutcome outcome,
        string calldata   reportUri
    ) external returns (uint256 id) {
        if (modelId == bytes32(0))              revert InvalidModelId();
        if (!_isReporter(modelId, msg.sender))  revert NotAuthorized(msg.sender);
        if (bytes(methodology).length == 0)     revert EmptyField();
        if (bytes(findings).length == 0)        revert EmptyField();
        if (bytes(reportUri).length == 0)       revert EmptyField();

        id = ++evaluationCount;
        AdversarialEvaluation storage e = _evaluations[id];
        e.id          = id;
        e.modelId     = modelId;
        e.methodology = methodology;
        e.findings    = findings;
        e.outcome     = outcome;
        e.reportUri   = reportUri;
        e.evaluatedBy = msg.sender;
        e.evaluatedAt = block.timestamp;

        _modelEvaluations[modelId].push(id);

        emit AdversarialEvaluationRecorded(id, modelId, outcome, msg.sender, block.timestamp);
    }

    // ─── Art. 55§1b — AI Office Incident Reports ─────────────────────────────

    /// @notice Report a serious incident to the AI Office (Art. 55§1b)
    /// @param modelId     GPAI model identifier
    /// @param severity    Assessed severity of the incident
    /// @param description Human-readable incident description
    /// @param reportUri   IPFS/Arweave URI to the formal report document
    /// @param occurredAt  Unix timestamp when the incident occurred (must not be in future)
    function reportIncident(
        bytes32          modelId,
        IncidentSeverity severity,
        string calldata  description,
        string calldata  reportUri,
        uint256          occurredAt
    ) external returns (uint256 id) {
        if (modelId == bytes32(0))              revert InvalidModelId();
        if (!_isReporter(modelId, msg.sender))  revert NotAuthorized(msg.sender);
        if (bytes(description).length == 0)     revert EmptyField();
        if (bytes(reportUri).length == 0)       revert EmptyField();
        if (occurredAt > block.timestamp)       revert FutureTimestamp(occurredAt, block.timestamp);

        id = ++incidentCount;
        AIOfficeIncident storage inc = _incidents[id];
        inc.id          = id;
        inc.modelId     = modelId;
        inc.severity    = severity;
        inc.status      = IncidentStatus.REPORTED;
        inc.description = description;
        inc.reportUri   = reportUri;
        inc.occurredAt  = occurredAt;
        inc.reportedBy  = msg.sender;
        inc.reportedAt  = block.timestamp;

        _modelIncidents[modelId].push(id);

        emit AIOfficeIncidentReported(id, modelId, severity, msg.sender, block.timestamp);
    }

    /// @notice Mark an AI Office incident as under review
    function markUnderReview(uint256 incidentId) external {
        AIOfficeIncident storage inc = _loadIncident(incidentId);
        if (!_isReporter(inc.modelId, msg.sender)) revert NotAuthorized(msg.sender);
        if (inc.status == IncidentStatus.RESOLVED)  revert IncidentAlreadyResolved(incidentId);
        inc.status = IncidentStatus.UNDER_REVIEW;
    }

    /// @notice Resolve an AI Office incident with a resolution document
    function resolveIncident(uint256 incidentId, string calldata resolutionUri) external {
        AIOfficeIncident storage inc = _loadIncident(incidentId);
        if (!_isReporter(inc.modelId, msg.sender)) revert NotAuthorized(msg.sender);
        if (inc.status == IncidentStatus.RESOLVED)  revert IncidentAlreadyResolved(incidentId);
        if (bytes(resolutionUri).length == 0)       revert EmptyField();
        inc.status        = IncidentStatus.RESOLVED;
        inc.resolutionUri = resolutionUri;
        emit AIOfficeIncidentResolved(incidentId, resolutionUri, msg.sender, block.timestamp);
    }

    // ─── Art. 55§1c — Cybersecurity Protections ──────────────────────────────

    /// @notice Record cybersecurity protections implemented (Art. 55§1c)
    /// @param modelId          GPAI model identifier
    /// @param measuresUri      IPFS/Arweave URI to cybersecurity measures document
    /// @param threatModel      Brief description of the threat model addressed
    /// @param pentestPerformed Whether an independent penetration test was conducted
    /// @param pentestUri       IPFS/Arweave URI to pentest report (empty if not performed)
    function recordCybersecurityProtection(
        bytes32         modelId,
        string calldata measuresUri,
        string calldata threatModel,
        bool            pentestPerformed,
        string calldata pentestUri
    ) external {
        if (modelId == bytes32(0))              revert InvalidModelId();
        if (!_isReporter(modelId, msg.sender))  revert NotAuthorized(msg.sender);
        if (bytes(measuresUri).length == 0)     revert EmptyField();
        if (bytes(threatModel).length == 0)     revert EmptyField();

        CybersecurityProtection storage c = _cybersecurity[modelId];
        c.modelId           = modelId;
        c.measuresUri       = measuresUri;
        c.threatModel       = threatModel;
        c.pentestPerformed  = pentestPerformed;
        c.pentestUri        = pentestUri;
        c.recordedBy        = msg.sender;
        c.recordedAt        = block.timestamp;
        _hasCybersecurity[modelId] = true;

        emit CybersecurityProtectionRecorded(modelId, pentestPerformed, msg.sender, block.timestamp);
    }

    // ─── Art. 55§1d — Energy Reports ─────────────────────────────────────────

    /// @notice Record energy consumption and environmental impact (Art. 55§1d)
    /// @param modelId                  GPAI model identifier
    /// @param trainingEnergyKwh        Total training energy in kWh
    /// @param inferenceEnergyKwhPer1M  Inference energy per 1M requests in kWh
    /// @param methodologyUri           IPFS/Arweave URI to measurement methodology
    /// @param reportUri                IPFS/Arweave URI to the full energy report
    function recordEnergyReport(
        bytes32         modelId,
        uint256         trainingEnergyKwh,
        uint256         inferenceEnergyKwhPer1M,
        string calldata methodologyUri,
        string calldata reportUri
    ) external {
        if (modelId == bytes32(0))              revert InvalidModelId();
        if (!_isReporter(modelId, msg.sender))  revert NotAuthorized(msg.sender);
        if (bytes(methodologyUri).length == 0)  revert EmptyField();
        if (bytes(reportUri).length == 0)       revert EmptyField();

        EnergyReport storage er = _energy[modelId];
        er.modelId                  = modelId;
        er.trainingEnergyKwh        = trainingEnergyKwh;
        er.inferenceEnergyKwhPer1M  = inferenceEnergyKwhPer1M;
        er.methodologyUri           = methodologyUri;
        er.reportUri                = reportUri;
        er.reportedBy               = msg.sender;
        er.reportedAt               = block.timestamp;
        _hasEnergy[modelId] = true;

        emit EnergyReportRecorded(modelId, trainingEnergyKwh, inferenceEnergyKwhPer1M, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get all adversarial evaluation records for a model
    function getEvaluations(bytes32 modelId) external view returns (AdversarialEvaluation[] memory result) {
        uint256[] storage ids = _modelEvaluations[modelId];
        result = new AdversarialEvaluation[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = _evaluations[ids[i]];
        }
    }

    /// @notice Get a single adversarial evaluation by ID
    function getEvaluation(uint256 id) external view returns (AdversarialEvaluation memory) {
        if (_evaluations[id].id == 0) revert EvaluationNotFound(id);
        return _evaluations[id];
    }

    /// @notice Get all AI Office incident reports for a model
    function getIncidents(bytes32 modelId) external view returns (AIOfficeIncident[] memory result) {
        uint256[] storage ids = _modelIncidents[modelId];
        result = new AIOfficeIncident[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = _incidents[ids[i]];
        }
    }

    /// @notice Get a single AI Office incident by ID
    function getIncident(uint256 id) external view returns (AIOfficeIncident memory) {
        if (_incidents[id].id == 0) revert IncidentNotFound(id);
        return _incidents[id];
    }

    /// @notice Get the cybersecurity protection record for a model
    function getCybersecurityProtection(bytes32 modelId) external view returns (CybersecurityProtection memory) {
        return _cybersecurity[modelId];
    }

    /// @notice Get the energy report for a model
    function getEnergyReport(bytes32 modelId) external view returns (EnergyReport memory) {
        return _energy[modelId];
    }

    /// @notice Returns true when all four Art. 55§1 obligations have been addressed
    /// @dev §1a: at least one evaluation recorded (PASS or CONDITIONAL_PASS).
    ///      §1b: incident reporting infrastructure is established (any incident reported OR no incidents).
    ///      §1c: cybersecurity protection documented.
    ///      §1d: energy report submitted.
    function isArt55Compliant(bytes32 modelId) external view returns (bool) {
        // §1a: at least one evaluation with a non-failing outcome
        uint256[] storage evalIds = _modelEvaluations[modelId];
        if (evalIds.length == 0) return false;
        bool hasPassingEval = false;
        for (uint256 i = 0; i < evalIds.length; i++) {
            if (_evaluations[evalIds[i]].outcome != EvaluationOutcome.FAIL) {
                hasPassingEval = true;
                break;
            }
        }
        if (!hasPassingEval) return false;
        // §1c: cybersecurity protection documented
        if (!_hasCybersecurity[modelId]) return false;
        // §1d: energy report submitted
        if (!_hasEnergy[modelId]) return false;
        return true;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _loadIncident(uint256 id) internal view returns (AIOfficeIncident storage) {
        if (_incidents[id].id == 0) revert IncidentNotFound(id);
        return _incidents[id];
    }

    function _isOwner(bytes32 modelId, address caller) internal view returns (bool) {
        return modelOwner[modelId] == caller || caller == deployer;
    }

    function _isReporter(bytes32 modelId, address caller) internal view returns (bool) {
        return modelOwner[modelId] == caller
            || reporters[modelId][caller]
            || caller == deployer;
    }
}
