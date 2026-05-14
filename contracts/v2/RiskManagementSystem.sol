// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RiskManagementSystem
/// @notice On-chain risk management lifecycle for high-risk AI systems — EU AI Act Article 9
/// @dev Implements the full Art. 9 lifecycle: identify → assess → mitigate → test → close.
///      Each risk record is immutable once written; status transitions are append-only.
///      Integrates with AIBOMRegistry (agentId) and IncidentRegistry (evidenceHash).
/// @custom:article Art. 9 — Risk management system
/// @custom:article Art. 9§2 — Risk identification and analysis
/// @custom:article Art. 9§3 — Risk mitigation and control measures
/// @custom:article Art. 9§5 — Testing to verify risk management measures
contract RiskManagementSystem {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Broad risk category — maps to Art. 9§2 risk domains
    enum RiskCategory {
        ACCURACY,       // incorrect outputs, hallucinations
        BIAS,           // discriminatory outcomes (Art. 10§2)
        SECURITY,       // adversarial attacks, model inversion
        PRIVACY,        // data leakage, re-identification
        SAFETY,         // physical/psychological harm
        OPERATIONAL,    // reliability, availability, performance
        LEGAL           // regulatory non-compliance
    }

    /// @dev Severity of a risk — scaled by likelihood × impact (Art. 9§2b)
    enum Severity { NEGLIGIBLE, LOW, MEDIUM, HIGH, CRITICAL }

    /// @dev Lifecycle status — transitions only move forward
    enum RiskStatus {
        IDENTIFIED,   // risk logged, not yet formally assessed
        ASSESSED,     // severity and likelihood set
        MITIGATED,    // at least one mitigation measure recorded
        TESTED,       // mitigation verified by a test record
        RESIDUAL,     // acknowledged residual risk — no further mitigation feasible
        CLOSED        // risk no longer applicable
    }

    struct RiskRecord {
        uint256      id;
        bytes32      agentId;         // ERC-8004 agent identifier
        RiskCategory category;
        Severity     severity;
        RiskStatus   status;
        string       description;     // human-readable risk description
        string       evidenceUri;     // IPFS/Arweave URI to supporting evidence
        uint16       likelihood;      // 0–10000 (scaled 1e4, e.g. 3000 = 30%)
        uint16       impact;          // 0–10000 (scaled 1e4)
        address      identifiedBy;
        uint256      identifiedAt;
        uint256      updatedAt;
    }

    struct MitigationRecord {
        uint256 riskId;
        string  measure;          // description of the mitigation measure
        string  documentUri;      // IPFS/Arweave URI to implementation evidence
        address recordedBy;
        uint256 recordedAt;
    }

    struct TestRecord {
        uint256 riskId;
        string  testDescription;
        bool    passed;
        string  resultUri;        // IPFS/Arweave URI to test results
        address testedBy;
        uint256 testedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public riskCount;

    mapping(uint256 => RiskRecord)      public risks;
    mapping(uint256 => MitigationRecord[]) private _mitigations;
    mapping(uint256 => TestRecord[])    private _tests;

    // agentId → risk IDs
    mapping(bytes32 => uint256[]) private _agentRisks;

    // per-agent authorised assessors (owner or deployer can always act)
    mapping(bytes32 => address)                     public agentOwner;
    mapping(bytes32 => mapping(address => bool))    public assessors;

    // ─── Events ──────────────────────────────────────────────────────────────

    event RiskIdentified(
        uint256 indexed  id,
        bytes32 indexed  agentId,
        RiskCategory     category,
        address          identifiedBy,
        uint256          timestamp
    );

    event RiskAssessed(
        uint256 indexed id,
        Severity        severity,
        uint16          likelihood,
        uint16          impact,
        uint256         timestamp
    );

    event MitigationRecorded(
        uint256 indexed riskId,
        string          measure,
        address         recordedBy,
        uint256         timestamp
    );

    event TestRecorded(
        uint256 indexed riskId,
        bool            passed,
        address         testedBy,
        uint256         timestamp
    );

    event RiskStatusChanged(
        uint256 indexed id,
        RiskStatus      from,
        RiskStatus      to,
        address         by,
        uint256         timestamp
    );

    event AssessorSet(
        bytes32 indexed agentId,
        address         assessor,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error RiskNotFound(uint256 riskId);
    error NotAuthorized(address caller);
    error InvalidLikelihood(uint16 value);
    error InvalidImpact(uint16 value);
    error InvalidStatusTransition(RiskStatus from, RiskStatus to);
    error AlreadyClosed(uint256 riskId);
    error AgentAlreadyOwned(bytes32 agentId);
    error EmptyDescription();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Agent Setup ─────────────────────────────────────────────────────────

    /// @notice Claim ownership of a risk management context for an agent (Art. 9 — system owner)
    function claimAgent(bytes32 agentId) external {
        if (agentId == bytes32(0))          revert InvalidAgentId();
        if (agentOwner[agentId] != address(0)) revert AgentAlreadyOwned(agentId);
        agentOwner[agentId] = msg.sender;
    }

    /// @notice Authorize or revoke an assessor for an agent
    function setAssessor(bytes32 agentId, address assessor, bool authorized) external {
        if (!_isAgentOwner(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        assessors[agentId][assessor] = authorized;
        emit AssessorSet(agentId, assessor, authorized, block.timestamp);
    }

    // ─── Risk Identification ─────────────────────────────────────────────────

    /// @notice Identify and log a new risk (Art. 9§2a)
    /// @param agentId      Target agent
    /// @param category     Risk category
    /// @param description  Human-readable risk description
    /// @param evidenceUri  IPFS/Arweave URI to supporting evidence (optional)
    function identifyRisk(
        bytes32         agentId,
        RiskCategory    category,
        string calldata description,
        string calldata evidenceUri
    ) external returns (uint256 riskId) {
        if (agentId == bytes32(0))              revert InvalidAgentId();
        if (bytes(description).length == 0)     revert EmptyDescription();
        if (!_isAuthorized(agentId, msg.sender)) revert NotAuthorized(msg.sender);

        riskId = ++riskCount;

        RiskRecord storage r = risks[riskId];
        r.id           = riskId;
        r.agentId      = agentId;
        r.category     = category;
        r.severity     = Severity.MEDIUM;   // default until assessed
        r.status       = RiskStatus.IDENTIFIED;
        r.description  = description;
        r.evidenceUri  = evidenceUri;
        r.identifiedBy = msg.sender;
        r.identifiedAt = block.timestamp;
        r.updatedAt    = block.timestamp;

        _agentRisks[agentId].push(riskId);

        emit RiskIdentified(riskId, agentId, category, msg.sender, block.timestamp);
    }

    // ─── Risk Assessment ─────────────────────────────────────────────────────

    /// @notice Assess a risk — set severity, likelihood, and impact (Art. 9§2b)
    /// @param riskId     Risk to assess
    /// @param severity   Qualitative severity
    /// @param likelihood 0–10000 (scaled 1e4) probability estimate
    /// @param impact     0–10000 (scaled 1e4) impact magnitude
    function assessRisk(
        uint256  riskId,
        Severity severity,
        uint16   likelihood,
        uint16   impact
    ) external {
        RiskRecord storage r = _loadRisk(riskId);
        if (!_isAuthorized(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (r.status == RiskStatus.CLOSED)          revert AlreadyClosed(riskId);
        if (likelihood > 10000)                     revert InvalidLikelihood(likelihood);
        if (impact > 10000)                         revert InvalidImpact(impact);

        RiskStatus prev = r.status;
        r.severity   = severity;
        r.likelihood = likelihood;
        r.impact     = impact;
        r.updatedAt  = block.timestamp;

        if (r.status == RiskStatus.IDENTIFIED) {
            r.status = RiskStatus.ASSESSED;
            emit RiskStatusChanged(riskId, prev, RiskStatus.ASSESSED, msg.sender, block.timestamp);
        }

        emit RiskAssessed(riskId, severity, likelihood, impact, block.timestamp);
    }

    // ─── Mitigation ──────────────────────────────────────────────────────────

    /// @notice Record a mitigation measure for a risk (Art. 9§3)
    /// @param riskId      Target risk
    /// @param measure     Description of the measure applied
    /// @param documentUri IPFS/Arweave URI to implementation evidence
    function recordMitigation(
        uint256         riskId,
        string calldata measure,
        string calldata documentUri
    ) external {
        RiskRecord storage r = _loadRisk(riskId);
        if (!_isAuthorized(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (r.status == RiskStatus.CLOSED)          revert AlreadyClosed(riskId);
        if (bytes(measure).length == 0)             revert EmptyDescription();

        _mitigations[riskId].push(MitigationRecord({
            riskId:      riskId,
            measure:     measure,
            documentUri: documentUri,
            recordedBy:  msg.sender,
            recordedAt:  block.timestamp
        }));

        RiskStatus prev = r.status;
        if (r.status == RiskStatus.IDENTIFIED || r.status == RiskStatus.ASSESSED) {
            r.status = RiskStatus.MITIGATED;
            emit RiskStatusChanged(riskId, prev, RiskStatus.MITIGATED, msg.sender, block.timestamp);
        }
        r.updatedAt = block.timestamp;

        emit MitigationRecorded(riskId, measure, msg.sender, block.timestamp);
    }

    // ─── Testing ─────────────────────────────────────────────────────────────

    /// @notice Record a test verifying a mitigation measure (Art. 9§5)
    /// @param riskId          Target risk
    /// @param testDescription Human-readable test description
    /// @param passed          Whether the test passed
    /// @param resultUri       IPFS/Arweave URI to test results
    function recordTest(
        uint256         riskId,
        string calldata testDescription,
        bool            passed,
        string calldata resultUri
    ) external {
        RiskRecord storage r = _loadRisk(riskId);
        if (!_isAuthorized(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (r.status == RiskStatus.CLOSED)          revert AlreadyClosed(riskId);
        if (bytes(testDescription).length == 0)     revert EmptyDescription();

        _tests[riskId].push(TestRecord({
            riskId:          riskId,
            testDescription: testDescription,
            passed:          passed,
            resultUri:       resultUri,
            testedBy:        msg.sender,
            testedAt:        block.timestamp
        }));

        RiskStatus prev = r.status;
        if (passed && r.status == RiskStatus.MITIGATED) {
            r.status = RiskStatus.TESTED;
            emit RiskStatusChanged(riskId, prev, RiskStatus.TESTED, msg.sender, block.timestamp);
        }
        r.updatedAt = block.timestamp;

        emit TestRecorded(riskId, passed, msg.sender, block.timestamp);
    }

    // ─── Status Transitions ──────────────────────────────────────────────────

    /// @notice Mark a risk as residual — no further mitigation feasible (Art. 9§4)
    function markResidual(uint256 riskId) external {
        RiskRecord storage r = _loadRisk(riskId);
        if (!_isAuthorized(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        _transition(r, riskId, RiskStatus.RESIDUAL);
    }

    /// @notice Close a risk — no longer applicable
    function closeRisk(uint256 riskId) external {
        RiskRecord storage r = _loadRisk(riskId);
        if (!_isAuthorized(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        _transition(r, riskId, RiskStatus.CLOSED);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get all risk IDs for an agent
    function getAgentRisks(bytes32 agentId) external view returns (uint256[] memory) {
        return _agentRisks[agentId];
    }

    /// @notice Get all mitigation records for a risk
    function getMitigations(uint256 riskId) external view returns (MitigationRecord[] memory) {
        if (risks[riskId].id == 0) revert RiskNotFound(riskId);
        return _mitigations[riskId];
    }

    /// @notice Get all test records for a risk
    function getTests(uint256 riskId) external view returns (TestRecord[] memory) {
        if (risks[riskId].id == 0) revert RiskNotFound(riskId);
        return _tests[riskId];
    }

    /// @notice Count open (non-closed) risks for an agent
    function openRiskCount(bytes32 agentId) external view returns (uint256 count) {
        uint256[] storage ids = _agentRisks[agentId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (risks[ids[i]].status != RiskStatus.CLOSED) count++;
        }
    }

    /// @notice Count risks at or above a given severity for an agent
    function risksAboveSeverity(bytes32 agentId, Severity minSeverity)
        external
        view
        returns (uint256 count)
    {
        uint256[] storage ids = _agentRisks[agentId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (risks[ids[i]].severity >= minSeverity) count++;
        }
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _loadRisk(uint256 riskId) internal view returns (RiskRecord storage r) {
        r = risks[riskId];
        if (r.id == 0) revert RiskNotFound(riskId);
    }

    /// @dev Allowed forward transitions only; RESIDUAL ↔ TESTED both allowed before CLOSED
    function _transition(RiskRecord storage r, uint256 riskId, RiskStatus to) internal {
        RiskStatus from = r.status;
        if (from == RiskStatus.CLOSED) revert AlreadyClosed(riskId);
        if (to == RiskStatus.CLOSED && from != RiskStatus.TESTED && from != RiskStatus.RESIDUAL) {
            revert InvalidStatusTransition(from, to);
        }
        if (to == RiskStatus.RESIDUAL && from == RiskStatus.IDENTIFIED) {
            revert InvalidStatusTransition(from, to);
        }
        r.status    = to;
        r.updatedAt = block.timestamp;
        emit RiskStatusChanged(riskId, from, to, msg.sender, block.timestamp);
    }

    function _isAgentOwner(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller || caller == deployer;
    }

    function _isAuthorized(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller
            || assessors[agentId][caller]
            || caller == deployer;
    }
}
