// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IncidentRegistry
/// @notice On-chain serious incident reporting registry — EU AI Act Article 73
/// @dev Enforces Art. 73§2 reporting timelines: 2 days (CRITICAL), 10 days (HIGH),
///      15 days (MEDIUM/LOW). Incidents progress through a forward-only status
///      lifecycle. Root-cause analysis and corrective measures (Art. 73§5) are
///      anchored via IPFS/Arweave URIs. All writes are immutable — regulators can
///      reconstruct the full incident history on-chain.
/// @custom:article Art. 73 — Reporting of serious incidents
/// @custom:article Art. 73§2 — Reporting timelines to market surveillance authorities
/// @custom:article Art. 73§5 — Obligation to provide corrective actions
contract IncidentRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Severity drives the Art. 73§2 reporting deadline
    enum Severity { LOW, MEDIUM, HIGH, CRITICAL }

    /// @dev Nature of harm — maps to Art. 73§1 qualifying conditions
    enum HarmType {
        DEATH,
        SERIOUS_HEALTH_HARM,
        SIGNIFICANT_PROPERTY_DAMAGE,
        FUNDAMENTAL_RIGHTS_VIOLATION,
        OTHER
    }

    /// @dev Forward-only status lifecycle
    enum Status { OPEN, REPORTED, UNDER_INVESTIGATION, RESOLVED, CLOSED }

    struct Incident {
        uint256   id;
        bytes32   agentId;
        Severity  severity;
        HarmType  harmType;
        Status    status;
        string    description;
        string    evidenceHash;        // hash or IPFS CID of incident evidence
        uint256   affectedPersons;     // Art. 73§3 — number of affected persons
        address   reportedBy;
        uint256   occurredAt;
        uint256   registeredAt;
        uint256   reportedToAuthorityAt;
        address   authorityAddress;    // national market surveillance authority
        string    authorityRef;        // authority-issued case reference
        bool      withinDeadline;
        string    rootCauseUri;        // Art. 73§5 — root cause analysis document
        string    correctionUri;       // Art. 73§5 — corrective measures document
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public constant CRITICAL_DEADLINE =  2 days;
    uint256 public constant HIGH_DEADLINE     = 10 days;
    uint256 public constant MEDIUM_DEADLINE   = 15 days;

    uint256 public incidentCount;

    mapping(uint256 => Incident)    public incidents;
    mapping(bytes32 => uint256[])   private _agentIncidents;

    // ─── Events ──────────────────────────────────────────────────────────────

    event IncidentRegistered(
        uint256 indexed id,
        bytes32 indexed agentId,
        Severity        severity,
        HarmType        harmType,
        uint256         occurredAt,
        uint256         timestamp
    );

    event IncidentReported(
        uint256 indexed id,
        address         authority,
        string          authorityRef,
        bool            withinDeadline,
        uint256         timestamp
    );

    event StatusAdvanced(
        uint256 indexed id,
        Status          from,
        Status          to,
        uint256         timestamp
    );

    event RootCauseUpdated(
        uint256 indexed id,
        string          rootCauseUri,
        uint256         timestamp
    );

    event CorrectionUpdated(
        uint256 indexed id,
        string          correctionUri,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error FutureTimestamp(uint256 provided, uint256 current);
    error IncidentNotFound(uint256 id);
    error NotAuthorized(address caller);
    error AlreadyReported(uint256 id);
    error AlreadyClosed(uint256 id);
    error InvalidStatusTransition(Status from, Status to);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /// @notice Register a serious incident (Art. 73§1)
    /// @param agentId          ERC-8004 agent identifier
    /// @param severity         Incident severity — drives reporting deadline
    /// @param harmType         Nature of harm (Art. 73§1 qualifying condition)
    /// @param description      Human-readable incident description
    /// @param evidenceHash     Hash or IPFS CID of supporting evidence
    /// @param affectedPersons  Number of persons affected (Art. 73§3)
    /// @param occurredAt       Block timestamp when incident occurred (must be ≤ now)
    function registerIncident(
        bytes32         agentId,
        Severity        severity,
        HarmType        harmType,
        string calldata description,
        string calldata evidenceHash,
        uint256         affectedPersons,
        uint256         occurredAt
    ) external returns (uint256 id) {
        if (agentId == bytes32(0))          revert InvalidAgentId();
        if (occurredAt > block.timestamp)   revert FutureTimestamp(occurredAt, block.timestamp);

        id = ++incidentCount;

        Incident storage inc = incidents[id];
        inc.id               = id;
        inc.agentId          = agentId;
        inc.severity         = severity;
        inc.harmType         = harmType;
        inc.status           = Status.OPEN;
        inc.description      = description;
        inc.evidenceHash     = evidenceHash;
        inc.affectedPersons  = affectedPersons;
        inc.reportedBy       = msg.sender;
        inc.occurredAt       = occurredAt;
        inc.registeredAt     = block.timestamp;

        _agentIncidents[agentId].push(id);

        emit IncidentRegistered(id, agentId, severity, harmType, occurredAt, block.timestamp);
    }

    // ─── Reporting ───────────────────────────────────────────────────────────

    /// @notice Report incident to the national market surveillance authority (Art. 73§2)
    /// @param id               Incident to report
    /// @param authority        Address (or identifier hash) of the notified authority
    /// @param authorityRef     Authority-issued case reference number
    function markReportedToAuthority(
        uint256         id,
        address         authority,
        string calldata authorityRef
    ) external {
        Incident storage inc = _load(id);
        if (inc.status != Status.OPEN) revert AlreadyReported(id);
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);

        uint256 deadline = _deadline(inc.severity);
        bool withinDeadline = (block.timestamp - inc.occurredAt) <= deadline;

        inc.reportedToAuthorityAt = block.timestamp;
        inc.authorityAddress      = authority;
        inc.authorityRef          = authorityRef;
        inc.withinDeadline        = withinDeadline;
        inc.status                = Status.REPORTED;

        emit IncidentReported(id, authority, authorityRef, withinDeadline, block.timestamp);
        emit StatusAdvanced(id, Status.OPEN, Status.REPORTED, block.timestamp);
    }

    // ─── Investigation & Resolution ──────────────────────────────────────────

    /// @notice Advance status to UNDER_INVESTIGATION
    function markUnderInvestigation(uint256 id) external {
        Incident storage inc = _load(id);
        if (inc.status != Status.REPORTED) revert InvalidStatusTransition(inc.status, Status.UNDER_INVESTIGATION);
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);
        _advance(inc, id, Status.UNDER_INVESTIGATION);
    }

    /// @notice Resolve the incident after root cause and corrections are documented
    function resolveIncident(uint256 id) external {
        Incident storage inc = _load(id);
        if (inc.status != Status.UNDER_INVESTIGATION && inc.status != Status.REPORTED) {
            revert InvalidStatusTransition(inc.status, Status.RESOLVED);
        }
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);
        _advance(inc, id, Status.RESOLVED);
    }

    /// @notice Close a resolved incident — terminal state
    function closeIncident(uint256 id) external {
        Incident storage inc = _load(id);
        if (inc.status != Status.RESOLVED) revert InvalidStatusTransition(inc.status, Status.CLOSED);
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);
        _advance(inc, id, Status.CLOSED);
    }

    // ─── Documentation ───────────────────────────────────────────────────────

    /// @notice Attach root cause analysis document URI (Art. 73§5)
    function updateRootCause(uint256 id, string calldata rootCauseUri) external {
        Incident storage inc = _load(id);
        if (inc.status == Status.CLOSED)     revert AlreadyClosed(id);
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);
        inc.rootCauseUri = rootCauseUri;
        emit RootCauseUpdated(id, rootCauseUri, block.timestamp);
    }

    /// @notice Attach corrective measures document URI (Art. 73§5)
    function updateCorrection(uint256 id, string calldata correctionUri) external {
        Incident storage inc = _load(id);
        if (inc.status == Status.CLOSED)     revert AlreadyClosed(id);
        if (!_isAuthorized(inc, msg.sender)) revert NotAuthorized(msg.sender);
        inc.correctionUri = correctionUri;
        emit CorrectionUpdated(id, correctionUri, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Returns true if incident is still within the Art. 73§2 reporting deadline
    function isWithinDeadline(uint256 id) external view returns (bool) {
        Incident storage inc = _load(id);
        return (block.timestamp - inc.occurredAt) <= _deadline(inc.severity);
    }

    /// @notice Returns the absolute deadline timestamp for reporting an incident
    function reportingDeadline(uint256 id) external view returns (uint256) {
        Incident storage inc = _load(id);
        return inc.occurredAt + _deadline(inc.severity);
    }

    /// @notice Get all incident IDs for an agent
    function getAgentIncidents(bytes32 agentId) external view returns (uint256[] memory) {
        return _agentIncidents[agentId];
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _load(uint256 id) internal view returns (Incident storage inc) {
        inc = incidents[id];
        if (inc.id == 0) revert IncidentNotFound(id);
    }

    function _advance(Incident storage inc, uint256 id, Status to) internal {
        Status from = inc.status;
        inc.status = to;
        emit StatusAdvanced(id, from, to, block.timestamp);
    }

    function _deadline(Severity severity) internal pure returns (uint256) {
        if (severity == Severity.CRITICAL) return CRITICAL_DEADLINE;
        if (severity == Severity.HIGH)     return HIGH_DEADLINE;
        return MEDIUM_DEADLINE;
    }

    function _isAuthorized(Incident storage inc, address caller) internal view returns (bool) {
        return inc.reportedBy == caller || caller == deployer;
    }
}
