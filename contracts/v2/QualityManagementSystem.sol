// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title QualityManagementSystem
/// @notice On-chain Quality Management System registry — EU AI Act Article 17
/// @dev Providers of high-risk AI systems must establish a written QMS covering all
///      nine policy areas listed in Art. 17§1(a–i). This contract registers the
///      system-level QMS record, tracks per-area policy documents (IPFS/Arweave
///      URIs), records internal audits, and exposes `isComplete()` / `isCurrent()`
///      views that other contracts can use as deployment gates.
/// @custom:article Art. 17 — Quality management system
/// @custom:article Art. 17§1 — Elements of the quality management system
contract QualityManagementSystem {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Nine mandatory policy areas from Art. 17§1(a–i)
    enum PolicyArea {
        COMPLIANCE_STRATEGY,    // §1a — regulatory compliance, conformity assessment
        DESIGN_AND_TESTING,     // §1b — design, testing, and examination techniques
        DATA_MANAGEMENT,        // §1c — training, testing, and validation procedures
        DOCUMENTATION,          // §1d — technical documentation and record-keeping
        LOGGING_AND_MONITORING, // §1e — logging and monitoring measures
        INCIDENT_REPORTING,     // §1f — incident reporting procedures (→ Art. 73)
        USER_COMMUNICATION,     // §1g — communication with deployers and users
        POST_MARKET_MONITORING, // §1h — post-market monitoring plan (→ Art. 72)
        ACCOUNTABILITY          // §1i — accountability lines and governance
    }

    uint256 internal constant POLICY_AREA_COUNT = 9;

    enum QMSStatus { DRAFT, ACTIVE, UNDER_REVIEW, SUPERSEDED }

    enum PolicyStatus { MISSING, DRAFT, ACTIVE, SUPERSEDED }

    struct QMSRecord {
        uint256    id;
        bytes32    agentId;         // ERC-8004 agent identifier
        string     providerName;    // Art. 17 — provider name
        string     systemVersion;   // version of the AI system this QMS applies to
        string     documentUri;     // IPFS/Arweave URI to the full QMS document
        QMSStatus  status;
        uint256    reviewIntervalDays; // how often QMS must be reviewed
        uint256    lastReviewAt;
        address    registeredBy;
        uint256    registeredAt;
        uint256    updatedAt;
    }

    struct PolicyRecord {
        PolicyArea   area;
        PolicyStatus status;
        string       policyUri;   // IPFS/Arweave URI to the policy document
        string       description; // brief description of the policy
        address      updatedBy;
        uint256      updatedAt;
    }

    struct AuditRecord {
        uint256 qmsId;
        string  findings;    // human-readable audit findings
        string  auditUri;    // IPFS/Arweave URI to the full audit report
        bool    passed;
        address auditor;
        uint256 auditedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public qmsCount;

    mapping(uint256 => QMSRecord)    private _qms;
    mapping(uint256 => mapping(uint256 => PolicyRecord)) private _policies; // qmsId → area → policy
    mapping(uint256 => AuditRecord[]) private _audits;

    mapping(bytes32 => uint256) private _agentQMS;  // agentId → active qmsId (latest)
    mapping(bytes32 => bool)    private _hasQMS;

    // per-QMS authorised contributors
    mapping(uint256 => mapping(address => bool)) public contributors;

    // ─── Events ──────────────────────────────────────────────────────────────

    event QMSRegistered(
        uint256 indexed id,
        bytes32 indexed agentId,
        string          providerName,
        string          documentUri,
        address         registeredBy,
        uint256         timestamp
    );

    event QMSStatusChanged(
        uint256 indexed id,
        QMSStatus       from,
        QMSStatus       to,
        address         by,
        uint256         timestamp
    );

    event PolicyUpdated(
        uint256 indexed qmsId,
        PolicyArea      area,
        PolicyStatus    status,
        string          policyUri,
        address         by,
        uint256         timestamp
    );

    event AuditRecorded(
        uint256 indexed qmsId,
        bool            passed,
        address         auditor,
        uint256         timestamp
    );

    event ContributorSet(
        uint256 indexed qmsId,
        address         contributor,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error QMSNotFound(uint256 qmsId);
    error AgentHasNoQMS(bytes32 agentId);
    error NotAuthorized(address caller);
    error InvalidStatus(QMSStatus current);
    error AlreadySuperseded(uint256 qmsId);
    error EmptyField();
    error InvalidReviewInterval(uint256 interval);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── QMS Registration ────────────────────────────────────────────────────

    /// @notice Register a Quality Management System for a high-risk AI agent (Art. 17)
    /// @param agentId            ERC-8004 agent identifier
    /// @param providerName       Provider name as it appears on the EU Declaration of Conformity
    /// @param systemVersion      Version of the AI system this QMS covers
    /// @param documentUri        IPFS/Arweave URI to the full QMS document
    /// @param reviewIntervalDays How often the QMS must be reviewed (Art. 17§3)
    function registerQMS(
        bytes32         agentId,
        string calldata providerName,
        string calldata systemVersion,
        string calldata documentUri,
        uint256         reviewIntervalDays
    ) external returns (uint256 id) {
        if (agentId == bytes32(0))            revert InvalidAgentId();
        if (bytes(providerName).length == 0)  revert EmptyField();
        if (bytes(documentUri).length == 0)   revert EmptyField();
        if (reviewIntervalDays == 0)          revert InvalidReviewInterval(reviewIntervalDays);

        id = ++qmsCount;

        QMSRecord storage q = _qms[id];
        q.id                 = id;
        q.agentId            = agentId;
        q.providerName       = providerName;
        q.systemVersion      = systemVersion;
        q.documentUri        = documentUri;
        q.status             = QMSStatus.DRAFT;
        q.reviewIntervalDays = reviewIntervalDays;
        q.lastReviewAt       = block.timestamp;
        q.registeredBy       = msg.sender;
        q.registeredAt       = block.timestamp;
        q.updatedAt          = block.timestamp;

        // point agentId to this (latest) QMS
        _agentQMS[agentId] = id;
        _hasQMS[agentId]   = true;

        emit QMSRegistered(id, agentId, providerName, documentUri, msg.sender, block.timestamp);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// @notice Activate the QMS — provider formally adopts it (Art. 17§1)
    function activate(uint256 qmsId) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isAuthorized(q, msg.sender))        revert NotAuthorized(msg.sender);
        if (q.status == QMSStatus.SUPERSEDED)     revert AlreadySuperseded(qmsId);
        if (q.status == QMSStatus.ACTIVE)         revert InvalidStatus(q.status);

        _changeStatus(q, qmsId, QMSStatus.ACTIVE);
    }

    /// @notice Mark QMS as under review (Art. 17§3 — periodic review)
    function markUnderReview(uint256 qmsId) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isAuthorized(q, msg.sender))    revert NotAuthorized(msg.sender);
        if (q.status != QMSStatus.ACTIVE)     revert InvalidStatus(q.status);

        _changeStatus(q, qmsId, QMSStatus.UNDER_REVIEW);
    }

    /// @notice Complete a review and re-activate the QMS
    function completeReview(uint256 qmsId) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isAuthorized(q, msg.sender))         revert NotAuthorized(msg.sender);
        if (q.status != QMSStatus.UNDER_REVIEW)    revert InvalidStatus(q.status);

        q.lastReviewAt = block.timestamp;
        q.updatedAt    = block.timestamp;
        _changeStatus(q, qmsId, QMSStatus.ACTIVE);
    }

    /// @notice Supersede this QMS (replaced by a newer version)
    function supersede(uint256 qmsId) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isAuthorized(q, msg.sender))    revert NotAuthorized(msg.sender);
        if (q.status == QMSStatus.SUPERSEDED) revert AlreadySuperseded(qmsId);

        _changeStatus(q, qmsId, QMSStatus.SUPERSEDED);
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    /// @notice Add or update a policy document for one of the nine Art. 17§1 areas
    /// @param qmsId       Target QMS
    /// @param area        Policy area (maps to Art. 17§1a–i)
    /// @param policyUri   IPFS/Arweave URI to the policy document
    /// @param description Brief description of the policy
    function setPolicy(
        uint256         qmsId,
        PolicyArea      area,
        string calldata policyUri,
        string calldata description
    ) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isContributor(qmsId, q, msg.sender)) revert NotAuthorized(msg.sender);
        if (q.status == QMSStatus.SUPERSEDED)       revert AlreadySuperseded(qmsId);
        if (bytes(policyUri).length == 0)           revert EmptyField();

        uint256 areaIdx = uint256(area);
        PolicyRecord storage p = _policies[qmsId][areaIdx];
        p.area        = area;
        p.status      = PolicyStatus.ACTIVE;
        p.policyUri   = policyUri;
        p.description = description;
        p.updatedBy   = msg.sender;
        p.updatedAt   = block.timestamp;

        q.updatedAt = block.timestamp;

        emit PolicyUpdated(qmsId, area, PolicyStatus.ACTIVE, policyUri, msg.sender, block.timestamp);
    }

    // ─── Audits ──────────────────────────────────────────────────────────────

    /// @notice Record an internal or third-party audit of the QMS (Art. 17§3)
    /// @param qmsId    Target QMS
    /// @param findings Human-readable summary of audit findings
    /// @param auditUri IPFS/Arweave URI to the full audit report
    /// @param passed   Whether the QMS passed the audit
    function recordAudit(
        uint256         qmsId,
        string calldata findings,
        string calldata auditUri,
        bool            passed
    ) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isContributor(qmsId, q, msg.sender)) revert NotAuthorized(msg.sender);
        if (bytes(findings).length == 0)            revert EmptyField();

        _audits[qmsId].push(AuditRecord({
            qmsId:     qmsId,
            findings:  findings,
            auditUri:  auditUri,
            passed:    passed,
            auditor:   msg.sender,
            auditedAt: block.timestamp
        }));

        emit AuditRecorded(qmsId, passed, msg.sender, block.timestamp);
    }

    // ─── Contributor Management ───────────────────────────────────────────────

    /// @notice Authorize or revoke a contributor for a QMS
    function setContributor(uint256 qmsId, address contributor, bool authorized) external {
        QMSRecord storage q = _loadQMS(qmsId);
        if (!_isAuthorized(q, msg.sender)) revert NotAuthorized(msg.sender);
        contributors[qmsId][contributor] = authorized;
        emit ContributorSet(qmsId, contributor, authorized, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get the QMS record by ID
    function getQMS(uint256 qmsId) external view returns (QMSRecord memory) {
        if (_qms[qmsId].id == 0) revert QMSNotFound(qmsId);
        return _qms[qmsId];
    }

    /// @notice Get the QMS ID for an agent (latest registered)
    function getAgentQMSId(bytes32 agentId) external view returns (uint256) {
        if (!_hasQMS[agentId]) revert AgentHasNoQMS(agentId);
        return _agentQMS[agentId];
    }

    /// @notice Get a specific policy area record for a QMS
    function getPolicy(uint256 qmsId, PolicyArea area) external view returns (PolicyRecord memory) {
        if (_qms[qmsId].id == 0) revert QMSNotFound(qmsId);
        return _policies[qmsId][uint256(area)];
    }

    /// @notice Get all audit records for a QMS
    function getAudits(uint256 qmsId) external view returns (AuditRecord[] memory) {
        if (_qms[qmsId].id == 0) revert QMSNotFound(qmsId);
        return _audits[qmsId];
    }

    /// @notice Returns true when all nine Art. 17§1 policy areas have an ACTIVE policy
    function isComplete(uint256 qmsId) external view returns (bool) {
        if (_qms[qmsId].id == 0) revert QMSNotFound(qmsId);
        for (uint256 i = 0; i < POLICY_AREA_COUNT; i++) {
            if (_policies[qmsId][i].status != PolicyStatus.ACTIVE) return false;
        }
        return true;
    }

    /// @notice Returns true when QMS is ACTIVE, complete, and not overdue for review
    function isCurrent(uint256 qmsId) external view returns (bool) {
        if (_qms[qmsId].id == 0) return false;
        QMSRecord storage q = _qms[qmsId];
        if (q.status != QMSStatus.ACTIVE) return false;
        uint256 nextReview = q.lastReviewAt + (q.reviewIntervalDays * 1 days);
        return block.timestamp <= nextReview;
    }

    /// @notice Count how many of the nine policy areas have active policies
    function activePolicyCount(uint256 qmsId) external view returns (uint256 count) {
        if (_qms[qmsId].id == 0) revert QMSNotFound(qmsId);
        for (uint256 i = 0; i < POLICY_AREA_COUNT; i++) {
            if (_policies[qmsId][i].status == PolicyStatus.ACTIVE) count++;
        }
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _loadQMS(uint256 qmsId) internal view returns (QMSRecord storage q) {
        q = _qms[qmsId];
        if (q.id == 0) revert QMSNotFound(qmsId);
    }

    function _changeStatus(QMSRecord storage q, uint256 qmsId, QMSStatus to) internal {
        QMSStatus from = q.status;
        q.status    = to;
        q.updatedAt = block.timestamp;
        emit QMSStatusChanged(qmsId, from, to, msg.sender, block.timestamp);
    }

    function _isAuthorized(QMSRecord storage q, address caller) internal view returns (bool) {
        return q.registeredBy == caller || caller == deployer;
    }

    function _isContributor(uint256 qmsId, QMSRecord storage q, address caller)
        internal view returns (bool)
    {
        return q.registeredBy == caller
            || contributors[qmsId][caller]
            || caller == deployer;
    }
}
