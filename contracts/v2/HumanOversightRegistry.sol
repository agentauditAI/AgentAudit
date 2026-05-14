// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HumanOversightRegistry
/// @notice On-chain human oversight measures registry — EU AI Act Article 14
/// @dev Records the oversight plan for each high-risk AI agent (§2–§4), logs every
///      human intervention (halt, override, escalation, resume), and tracks the
///      mandatory stop-button capability (§4e). Immutable event log ensures
///      regulators can verify that oversight measures were actually exercised.
/// @custom:article Art. 14 — Human oversight
/// @custom:article Art. 14§2 — Oversight measures preventing risk
/// @custom:article Art. 14§4 — Specific oversight capabilities
/// @custom:article Art. 14§4e — Ability to interrupt the AI system
contract HumanOversightRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Degree of human control over the AI system (Art. 14§1)
    enum OversightLevel {
        AUTOMATED,           // no real-time human involvement — minimal risk only
        HUMAN_ON_THE_LOOP,   // human monitors, can intervene async
        HUMAN_IN_THE_LOOP,   // human approves before each consequential action
        HUMAN_IN_COMMAND     // human initiates every action
    }

    /// @dev Type of human intervention recorded on-chain (Art. 14§4)
    enum InterventionType {
        HALT,            // §4e — full stop of the AI system
        PAUSE,           // temporary suspension pending review
        RESUME,          // system restarted after halt/pause
        OVERRIDE_OUTPUT, // §4d — human rejected and replaced AI output
        ESCALATE,        // §4c — output flagged for senior review
        AUDIT_REVIEW     // §4a — scheduled review of AI behaviour
    }

    /// @dev Oversight plan registered for a specific agent (Art. 14§2)
    struct OversightPlan {
        bytes32        agentId;
        OversightLevel level;
        string         description;         // human-readable oversight measures
        string         interfaceToolsUri;   // §4a — URI to human-machine interface docs
        bool           hasStopButton;       // §4e — whether a halt mechanism is implemented
        string         stopButtonUri;       // URI documenting the stop-button mechanism
        address        planOwner;
        uint256        registeredAt;
        uint256        updatedAt;
        bool           active;
    }

    /// @dev Individual human intervention event
    struct InterventionRecord {
        uint256          id;
        bytes32          agentId;
        InterventionType interventionType;
        string           reason;           // human-readable justification
        string           evidenceUri;      // IPFS/Arweave URI to supporting evidence
        bytes32          decisionRef;      // optional reference to DecisionProvenance txHash
        address          overseer;
        uint256          timestamp;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public interventionCount;

    // agentId → OversightPlan
    mapping(bytes32 => OversightPlan) public plans;
    mapping(bytes32 => bool)          private _planExists;

    // interventionId → InterventionRecord
    mapping(uint256 => InterventionRecord) public interventions;

    // agentId → all intervention IDs
    mapping(bytes32 => uint256[]) private _agentInterventions;

    // agentId → authorised overseers
    mapping(bytes32 => mapping(address => bool)) public overseers;

    // agentId → whether currently halted
    mapping(bytes32 => bool) public halted;

    // ─── Events ──────────────────────────────────────────────────────────────

    event OversightPlanRegistered(
        bytes32 indexed agentId,
        OversightLevel  level,
        bool            hasStopButton,
        address         planOwner,
        uint256         timestamp
    );

    event OversightPlanUpdated(
        bytes32 indexed agentId,
        OversightLevel  newLevel,
        uint256         timestamp
    );

    event InterventionLogged(
        uint256 indexed        id,
        bytes32 indexed        agentId,
        InterventionType       interventionType,
        address                overseer,
        uint256                timestamp
    );

    event AgentHalted(
        bytes32 indexed agentId,
        address         by,
        string          reason,
        uint256         timestamp
    );

    event AgentResumed(
        bytes32 indexed agentId,
        address         by,
        uint256         timestamp
    );

    event OverseerSet(
        bytes32 indexed agentId,
        address         overseer,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error PlanNotFound(bytes32 agentId);
    error PlanAlreadyExists(bytes32 agentId);
    error PlanInactive(bytes32 agentId);
    error NotAuthorized(address caller);
    error AlreadyHalted(bytes32 agentId);
    error NotHalted(bytes32 agentId);
    error EmptyDescription();
    error StopButtonRequired();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Plan Registration ───────────────────────────────────────────────────

    /// @notice Register an oversight plan for a high-risk AI agent (Art. 14§2)
    /// @param agentId           ERC-8004 agent identifier
    /// @param level             Degree of human control
    /// @param description       Description of oversight measures
    /// @param interfaceToolsUri URI to human-machine interface documentation (§4a)
    /// @param hasStopButton     Whether a halt mechanism is implemented (§4e)
    /// @param stopButtonUri     URI documenting the stop mechanism
    function registerPlan(
        bytes32         agentId,
        OversightLevel  level,
        string calldata description,
        string calldata interfaceToolsUri,
        bool            hasStopButton,
        string calldata stopButtonUri
    ) external {
        if (agentId == bytes32(0))           revert InvalidAgentId();
        if (_planExists[agentId])            revert PlanAlreadyExists(agentId);
        if (bytes(description).length == 0)  revert EmptyDescription();
        // High-risk agents operating in human-facing contexts must declare a stop button
        if (level == OversightLevel.HUMAN_IN_THE_LOOP && !hasStopButton) revert StopButtonRequired();

        OversightPlan storage p = plans[agentId];
        p.agentId          = agentId;
        p.level            = level;
        p.description      = description;
        p.interfaceToolsUri = interfaceToolsUri;
        p.hasStopButton    = hasStopButton;
        p.stopButtonUri    = stopButtonUri;
        p.planOwner        = msg.sender;
        p.registeredAt     = block.timestamp;
        p.updatedAt        = block.timestamp;
        p.active           = true;

        _planExists[agentId] = true;

        emit OversightPlanRegistered(agentId, level, hasStopButton, msg.sender, block.timestamp);
    }

    /// @notice Update oversight level and description
    function updatePlan(
        bytes32         agentId,
        OversightLevel  newLevel,
        string calldata newDescription
    ) external {
        _requirePlan(agentId);
        if (!_isOwner(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (!plans[agentId].active)          revert PlanInactive(agentId);
        if (bytes(newDescription).length == 0) revert EmptyDescription();
        if (newLevel == OversightLevel.HUMAN_IN_THE_LOOP && !plans[agentId].hasStopButton) {
            revert StopButtonRequired();
        }

        plans[agentId].level       = newLevel;
        plans[agentId].description = newDescription;
        plans[agentId].updatedAt   = block.timestamp;

        emit OversightPlanUpdated(agentId, newLevel, block.timestamp);
    }

    // ─── Overseer Management ─────────────────────────────────────────────────

    /// @notice Authorize or revoke an overseer for an agent
    function setOverseer(bytes32 agentId, address overseer, bool authorized) external {
        _requirePlan(agentId);
        if (!_isOwner(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        overseers[agentId][overseer] = authorized;
        emit OverseerSet(agentId, overseer, authorized, block.timestamp);
    }

    // ─── Halt / Resume (Art. 14§4e — Stop Button) ────────────────────────────

    /// @notice Halt the AI system immediately (Art. 14§4e — stop button)
    /// @param agentId    Agent to halt
    /// @param reason     Human-readable reason for the halt
    /// @param evidenceUri Optional URI to supporting evidence
    function halt(
        bytes32         agentId,
        string calldata reason,
        string calldata evidenceUri
    ) external {
        _requirePlan(agentId);
        if (!_isAuthorized(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (!plans[agentId].active)               revert PlanInactive(agentId);
        if (halted[agentId])                      revert AlreadyHalted(agentId);
        if (bytes(reason).length == 0)            revert EmptyDescription();

        halted[agentId] = true;

        uint256 id = _logIntervention(agentId, InterventionType.HALT, reason, evidenceUri, bytes32(0));
        emit AgentHalted(agentId, msg.sender, reason, block.timestamp);
        emit InterventionLogged(id, agentId, InterventionType.HALT, msg.sender, block.timestamp);
    }

    /// @notice Resume the AI system after a halt
    /// @param agentId    Agent to resume
    /// @param evidenceUri URI to evidence of review/clearance
    function resume(
        bytes32         agentId,
        string calldata evidenceUri
    ) external {
        _requirePlan(agentId);
        if (!_isAuthorized(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (!halted[agentId])                    revert NotHalted(agentId);

        halted[agentId] = false;

        uint256 id = _logIntervention(agentId, InterventionType.RESUME, "System resumed", evidenceUri, bytes32(0));
        emit AgentResumed(agentId, msg.sender, block.timestamp);
        emit InterventionLogged(id, agentId, InterventionType.RESUME, msg.sender, block.timestamp);
    }

    // ─── Intervention Logging ────────────────────────────────────────────────

    /// @notice Log any human oversight intervention (Art. 14§4)
    /// @param agentId          Target agent
    /// @param interventionType Type of human action taken
    /// @param reason           Justification
    /// @param evidenceUri      IPFS/Arweave URI to supporting evidence
    /// @param decisionRef      Optional reference to a DecisionProvenance record
    function logIntervention(
        bytes32          agentId,
        InterventionType interventionType,
        string calldata  reason,
        string calldata  evidenceUri,
        bytes32          decisionRef
    ) external returns (uint256 id) {
        _requirePlan(agentId);
        if (!_isAuthorized(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (!plans[agentId].active)               revert PlanInactive(agentId);
        if (bytes(reason).length == 0)            revert EmptyDescription();
        // HALT and RESUME must go through dedicated functions to update halted state
        if (interventionType == InterventionType.HALT)   revert NotAuthorized(msg.sender);
        if (interventionType == InterventionType.RESUME) revert NotAuthorized(msg.sender);

        id = _logIntervention(agentId, interventionType, reason, evidenceUri, decisionRef);
        emit InterventionLogged(id, agentId, interventionType, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get all intervention IDs for an agent
    function getAgentInterventions(bytes32 agentId) external view returns (uint256[] memory) {
        return _agentInterventions[agentId];
    }

    /// @notice Count interventions of a specific type for an agent
    function countByType(bytes32 agentId, InterventionType t)
        external
        view
        returns (uint256 count)
    {
        uint256[] storage ids = _agentInterventions[agentId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (interventions[ids[i]].interventionType == t) count++;
        }
    }

    /// @notice Total intervention count across all agents
    function totalInterventions() external view returns (uint256) {
        return interventionCount;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _requirePlan(bytes32 agentId) internal view {
        if (!_planExists[agentId]) revert PlanNotFound(agentId);
    }

    function _logIntervention(
        bytes32          agentId,
        InterventionType itype,
        string memory    reason,
        string memory    evidenceUri,
        bytes32          decisionRef
    ) internal returns (uint256 id) {
        id = ++interventionCount;
        interventions[id] = InterventionRecord({
            id:               id,
            agentId:          agentId,
            interventionType: itype,
            reason:           reason,
            evidenceUri:      evidenceUri,
            decisionRef:      decisionRef,
            overseer:         msg.sender,
            timestamp:        block.timestamp
        });
        _agentInterventions[agentId].push(id);
    }

    function _isOwner(bytes32 agentId, address caller) internal view returns (bool) {
        return plans[agentId].planOwner == caller || caller == deployer;
    }

    function _isAuthorized(bytes32 agentId, address caller) internal view returns (bool) {
        return plans[agentId].planOwner == caller
            || overseers[agentId][caller]
            || caller == deployer;
    }
}
