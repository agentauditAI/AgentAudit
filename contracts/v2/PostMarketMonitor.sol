// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PostMarketMonitor
 * @notice EU AI Act Article 72 — Post-market monitoring system
 * @dev Continuous on-chain monitoring of AI agent performance metrics.
 *      Tracks incidents, drift, error rates, and compliance scores.
 *      Integrates with AuditVault and IncidentRegistry.
 * @custom:erc ERC-8004 (Trustless Agents)
 * @custom:article Art. 72 — Post-market monitoring plan
 */
contract PostMarketMonitor {

    // ─── Types ───────────────────────────────────────────────────────────────

    enum AlertLevel { NONE, LOW, MEDIUM, HIGH, CRITICAL }
    enum MetricType { ERROR_RATE, DRIFT_SCORE, LATENCY_MS, COMPLIANCE_SCORE, CUSTOM }

    struct MonitoringPlan {
        address agent;
        address owner;
        string  systemName;         // EU AI Act: system identifier
        string  riskCategory;       // Annex III category (e.g. "HR", "Healthcare")
        uint256 reviewIntervalDays; // Art. 72: periodic review interval
        uint256 enrolledAt;
        uint256 lastReviewAt;
        bool    active;
    }

    struct MetricRecord {
        address    agent;
        MetricType metricType;
        string     metricName;
        int256     value;           // scaled by 1e4 for decimals
        int256     threshold;       // alert threshold
        AlertLevel alertLevel;
        string     context;         // free-form context / model version
        uint256    recordedAt;
        bytes32    txRef;           // optional reference to AuditVault txHash
    }

    struct PerformanceSummary {
        uint256 totalMetrics;
        uint256 alertsLow;
        uint256 alertsMedium;
        uint256 alertsHigh;
        uint256 alertsCritical;
        int256  lastComplianceScore; // 0–10000 (scaled 1e4)
        uint256 lastUpdatedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    // agent → MonitoringPlan
    mapping(address => MonitoringPlan) public plans;

    // agent → MetricRecord[]
    mapping(address => MetricRecord[]) private _metrics;

    // agent → PerformanceSummary
    mapping(address => PerformanceSummary) public summaries;

    // agent → authorized reporters
    mapping(address => mapping(address => bool)) public reporters;

    // global registry
    address[] private _enrolledAgents;
    mapping(address => bool) private _isEnrolled;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgentEnrolled(
        address indexed agent,
        address indexed owner,
        string systemName,
        string riskCategory,
        uint256 reviewIntervalDays,
        uint256 timestamp
    );

    event MetricRecorded(
        address indexed agent,
        MetricType indexed metricType,
        string metricName,
        int256 value,
        int256 threshold,
        AlertLevel alertLevel,
        uint256 timestamp
    );

    event AlertTriggered(
        address indexed agent,
        AlertLevel indexed level,
        string metricName,
        int256 value,
        int256 threshold,
        uint256 timestamp
    );

    event ReviewCompleted(
        address indexed agent,
        address indexed reviewer,
        int256 complianceScore,
        string notes,
        uint256 timestamp
    );

    event ReporterAuthorized(
        address indexed agent,
        address indexed reporter,
        bool authorized,
        uint256 timestamp
    );

    event PlanDeactivated(
        address indexed agent,
        address indexed by,
        string reason,
        uint256 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotOwner(address caller, address owner);
    error NotReporter(address caller, address agent);
    error AlreadyEnrolled(address agent);
    error NotEnrolled(address agent);
    error PlanInactive(address agent);
    error InvalidScore(int256 score);
    error InvalidInterval(uint256 interval);
    error InvalidThreshold();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner(address agent) {
        if (plans[agent].owner != msg.sender) revert NotOwner(msg.sender, plans[agent].owner);
        _;
    }

    modifier onlyReporter(address agent) {
        if (!reporters[agent][msg.sender] && plans[agent].owner != msg.sender) {
            revert NotReporter(msg.sender, agent);
        }
        _;
    }

    modifier isEnrolled(address agent) {
        if (!_isEnrolled[agent]) revert NotEnrolled(agent);
        _;
    }

    modifier isActive(address agent) {
        if (!plans[agent].active) revert PlanInactive(agent);
        _;
    }

    // ─── Enrollment ──────────────────────────────────────────────────────────

    /**
     * @notice Enroll an AI agent into post-market monitoring (Art. 72)
     * @param agent           Agent contract or wallet address
     * @param systemName      Human-readable system name
     * @param riskCategory    Annex III category
     * @param reviewIntervalDays  Periodic review interval (min 1 day)
     */
    function enroll(
        address agent,
        string calldata systemName,
        string calldata riskCategory,
        uint256 reviewIntervalDays
    ) external {
        if (_isEnrolled[agent]) revert AlreadyEnrolled(agent);
        if (reviewIntervalDays == 0) revert InvalidInterval(reviewIntervalDays);

        plans[agent] = MonitoringPlan({
            agent:              agent,
            owner:              msg.sender,
            systemName:         systemName,
            riskCategory:       riskCategory,
            reviewIntervalDays: reviewIntervalDays,
            enrolledAt:         block.timestamp,
            lastReviewAt:       block.timestamp,
            active:             true
        });

        summaries[agent].lastUpdatedAt = block.timestamp;

        _isEnrolled[agent] = true;
        _enrolledAgents.push(agent);

        emit AgentEnrolled(
            agent,
            msg.sender,
            systemName,
            riskCategory,
            reviewIntervalDays,
            block.timestamp
        );
    }

    // ─── Reporter Management ─────────────────────────────────────────────────

    /**
     * @notice Authorize or revoke a reporter for an agent
     */
    function setReporter(address agent, address reporter, bool authorized)
        external
        isEnrolled(agent)
        onlyOwner(agent)
    {
        reporters[agent][reporter] = authorized;
        emit ReporterAuthorized(agent, reporter, authorized, block.timestamp);
    }

    // ─── Metric Recording ────────────────────────────────────────────────────

    /**
     * @notice Record a performance metric for an enrolled agent (Art. 72)
     * @param agent       Target agent
     * @param metricType  Enum metric type
     * @param metricName  Human-readable name (e.g. "error_rate_7d")
     * @param value       Metric value scaled by 1e4
     * @param threshold   Alert threshold scaled by 1e4
     * @param context     Optional context (model version, deployment id, etc.)
     * @param txRef       Optional AuditVault tx reference
     */
    function recordMetric(
        address agent,
        MetricType metricType,
        string calldata metricName,
        int256 value,
        int256 threshold,
        string calldata context,
        bytes32 txRef
    )
        external
        isEnrolled(agent)
        onlyReporter(agent)
        isActive(agent)
    {
        AlertLevel level = _computeAlertLevel(metricType, value, threshold);

        MetricRecord memory record = MetricRecord({
            agent:       agent,
            metricType:  metricType,
            metricName:  metricName,
            value:       value,
            threshold:   threshold,
            alertLevel:  level,
            context:     context,
            recordedAt:  block.timestamp,
            txRef:       txRef
        });

        _metrics[agent].push(record);

        // Update summary
        PerformanceSummary storage s = summaries[agent];
        s.totalMetrics++;
        s.lastUpdatedAt = block.timestamp;

        if (level == AlertLevel.LOW)      s.alertsLow++;
        if (level == AlertLevel.MEDIUM)   s.alertsMedium++;
        if (level == AlertLevel.HIGH)     s.alertsHigh++;
        if (level == AlertLevel.CRITICAL) s.alertsCritical++;

        if (metricType == MetricType.COMPLIANCE_SCORE) {
            s.lastComplianceScore = value;
        }

        emit MetricRecorded(agent, metricType, metricName, value, threshold, level, block.timestamp);

        if (level >= AlertLevel.MEDIUM) {
            emit AlertTriggered(agent, level, metricName, value, threshold, block.timestamp);
        }
    }

    /**
     * @notice Record periodic review (Art. 72 — review plan)
     * @param agent           Agent address
     * @param complianceScore 0–10000 (scaled 1e4, e.g. 9500 = 95.00%)
     * @param notes           Reviewer notes (stored on-chain for immutability)
     */
    function recordReview(
        address agent,
        int256 complianceScore,
        string calldata notes
    )
        external
        isEnrolled(agent)
        onlyReporter(agent)
        isActive(agent)
    {
        if (complianceScore < 0 || complianceScore > 10000) revert InvalidScore(complianceScore);

        plans[agent].lastReviewAt = block.timestamp;

        PerformanceSummary storage s = summaries[agent];
        s.lastComplianceScore = complianceScore;
        s.lastUpdatedAt = block.timestamp;

        emit ReviewCompleted(agent, msg.sender, complianceScore, notes, block.timestamp);
    }

    // ─── Plan Management ─────────────────────────────────────────────────────

    /**
     * @notice Deactivate a monitoring plan
     */
    function deactivate(address agent, string calldata reason)
        external
        isEnrolled(agent)
        onlyOwner(agent)
    {
        plans[agent].active = false;
        emit PlanDeactivated(agent, msg.sender, reason, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /**
     * @notice Get all metric records for an agent
     */
    function getMetrics(address agent)
        external
        view
        isEnrolled(agent)
        returns (MetricRecord[] memory)
    {
        return _metrics[agent];
    }

    /**
     * @notice Get last N metrics for an agent
     */
    function getRecentMetrics(address agent, uint256 count)
        external
        view
        isEnrolled(agent)
        returns (MetricRecord[] memory)
    {
        MetricRecord[] storage all = _metrics[agent];
        uint256 len = all.length;
        uint256 n = count > len ? len : count;
        MetricRecord[] memory result = new MetricRecord[](n);
        for (uint256 i = 0; i < n; i++) {
            result[i] = all[len - n + i];
        }
        return result;
    }

    /**
     * @notice Get metrics above a given alert level
     */
    function getAlerts(address agent, AlertLevel minLevel)
        external
        view
        isEnrolled(agent)
        returns (MetricRecord[] memory)
    {
        MetricRecord[] storage all = _metrics[agent];
        uint256 count;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].alertLevel >= minLevel) count++;
        }
        MetricRecord[] memory result = new MetricRecord[](count);
        uint256 idx;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].alertLevel >= minLevel) result[idx++] = all[i];
        }
        return result;
    }

    /**
     * @notice Check if agent is overdue for review
     */
    function isReviewDue(address agent)
        external
        view
        isEnrolled(agent)
        returns (bool due, uint256 overdueBySeconds)
    {
        MonitoringPlan storage p = plans[agent];
        uint256 nextReview = p.lastReviewAt + (p.reviewIntervalDays * 1 days);
        if (block.timestamp >= nextReview) {
            due = true;
            overdueBySeconds = block.timestamp - nextReview;
        }
    }

    /**
     * @notice Get all enrolled agents
     */
    function getEnrolledAgents() external view returns (address[] memory) {
        return _enrolledAgents;
    }

    /**
     * @notice Get total metric count for an agent
     */
    function getMetricCount(address agent) external view returns (uint256) {
        return _metrics[agent].length;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    /**
     * @dev Compute alert level based on metric type and value vs threshold
     *      For COMPLIANCE_SCORE: lower is worse
     *      For ERROR_RATE, DRIFT_SCORE, LATENCY_MS: higher is worse
     */
    function _computeAlertLevel(
        MetricType metricType,
        int256 value,
        int256 threshold
    ) internal pure returns (AlertLevel) {
        if (metricType == MetricType.COMPLIANCE_SCORE) {
            // Score below threshold = bad
            if (value >= threshold) return AlertLevel.NONE;
            int256 diff = threshold - value;
            if (diff <= 500)  return AlertLevel.LOW;
            if (diff <= 1500) return AlertLevel.MEDIUM;
            if (diff <= 3000) return AlertLevel.HIGH;
            return AlertLevel.CRITICAL;
        } else {
            // Value above threshold = bad
            if (value <= threshold) return AlertLevel.NONE;
            int256 diff = value - threshold;
            int256 pct = threshold > 0 ? (diff * 10000) / threshold : int256(10000);
            if (pct <= 1000)  return AlertLevel.LOW;
            if (pct <= 10000) return AlertLevel.MEDIUM;
            if (pct <= 50000) return AlertLevel.HIGH;
            return AlertLevel.CRITICAL;
        }
    }
}
