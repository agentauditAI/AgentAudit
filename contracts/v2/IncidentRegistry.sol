// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IncidentRegistry
/// @notice On-chain incident reporting — EU AI Act Article 73
/// @dev Enforces 15/10/2 day reporting timelines
contract IncidentRegistry {

    enum Severity { LOW, MEDIUM, HIGH, CRITICAL }
    enum Status   { OPEN, REPORTED, RESOLVED, CLOSED }

    struct Incident {
        uint256 id;
        bytes32 agentId;
        Severity severity;
        Status   status;
        string   description;
        string   evidenceHash;
        address  reportedBy;
        uint256  occurredAt;
        uint256  registeredAt;
        uint256  reportedToAuthorityAt;
        bool     withinDeadline;
    }

    uint256 public constant CRITICAL_DEADLINE = 2 days;
    uint256 public constant HIGH_DEADLINE     = 10 days;
    uint256 public constant MEDIUM_DEADLINE   = 15 days;

    mapping(uint256 => Incident) public incidents;
    mapping(bytes32 => uint256[]) public agentIncidents;
    uint256 public incidentCount;
    address public owner;

    event IncidentRegistered(uint256 indexed id, bytes32 indexed agentId, Severity severity, uint256 occurredAt);
    event IncidentReported(uint256 indexed id, uint256 reportedAt, bool withinDeadline);
    event IncidentResolved(uint256 indexed id, uint256 resolvedAt);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() { owner = msg.sender; }

    function registerIncident(bytes32 agentId, Severity severity, string calldata description, string calldata evidenceHash, uint256 occurredAt) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(occurredAt <= block.timestamp, "Future timestamp");
        uint256 id = ++incidentCount;
        incidents[id] = Incident(id, agentId, severity, Status.OPEN, description, evidenceHash, msg.sender, occurredAt, block.timestamp, 0, false);
        agentIncidents[agentId].push(id);
        emit IncidentRegistered(id, agentId, severity, occurredAt);
        return id;
    }

    function markReportedToAuthority(uint256 id) external {
        Incident storage inc = incidents[id];
        require(inc.id != 0, "Incident not found");
        require(inc.status == Status.OPEN, "Already reported");
        uint256 deadline = _getDeadline(inc.severity);
        bool withinDeadline = (block.timestamp - inc.occurredAt) <= deadline;
        inc.reportedToAuthorityAt = block.timestamp;
        inc.withinDeadline = withinDeadline;
        inc.status = Status.REPORTED;
        emit IncidentReported(id, block.timestamp, withinDeadline);
    }

    function resolveIncident(uint256 id) external {
        Incident storage inc = incidents[id];
        require(inc.id != 0, "Incident not found");
        require(inc.reportedBy == msg.sender || msg.sender == owner, "Not authorized");
        inc.status = Status.RESOLVED;
        emit IncidentResolved(id, block.timestamp);
    }

    function isWithinDeadline(uint256 id) external view returns (bool) {
        Incident storage inc = incidents[id];
        require(inc.id != 0, "Incident not found");
        return (block.timestamp - inc.occurredAt) <= _getDeadline(inc.severity);
    }

    function getAgentIncidents(bytes32 agentId) external view returns (uint256[] memory) {
        return agentIncidents[agentId];
    }

    function _getDeadline(Severity severity) internal pure returns (uint256) {
        if (severity == Severity.CRITICAL) return CRITICAL_DEADLINE;
        if (severity == Severity.HIGH)     return HIGH_DEADLINE;
        return MEDIUM_DEADLINE;
    }
}