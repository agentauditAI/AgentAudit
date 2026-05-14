// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AccuracyRobustnessRegistry
/// @notice On-chain accuracy, robustness, and cybersecurity registry for high-risk AI — EU AI Act Art. 15
/// @dev Providers of high-risk AI must demonstrate appropriate accuracy levels (§1–2), resilience
///      against errors and adversarial inputs (§3), and cybersecurity protections (§5). This
///      contract records accuracy benchmarks (per metric, with threshold vs. achieved), robustness
///      test results (adversarial, noise, drift, stress), and cybersecurity assessments. The
///      `isArt15Compliant()` view acts as an on-chain gate: all benchmarks passing, at least one
///      robustness test passing, and a cybersecurity assessment at BASIC or above.
/// @custom:article Art. 15 — Accuracy, robustness, and cybersecurity
/// @custom:article Art. 15§1 — Design to achieve appropriate accuracy levels
/// @custom:article Art. 15§3 — Resilience against errors, faults, and adversarial inputs
/// @custom:article Art. 15§5 — Cybersecurity measures against adversarial attacks
contract AccuracyRobustnessRegistry {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Standard ML performance metrics; CUSTOM allows provider-defined metrics
    enum MetricType {
        ACCURACY,           // overall classification accuracy
        PRECISION,          // positive predictive value
        RECALL,             // sensitivity / true positive rate
        F1_SCORE,           // harmonic mean of precision and recall
        AUC_ROC,            // area under ROC curve
        CUSTOM              // provider-defined metric (supply metricName)
    }

    /// @dev Categories of robustness testing per Art. 15§3
    enum RobustnessTestType {
        ADVERSARIAL_INPUT,      // crafted inputs designed to fool the model
        NOISE_INJECTION,        // random noise applied to inputs
        DATA_DRIFT,             // distribution shift from training data
        OUT_OF_DISTRIBUTION,    // inputs outside training domain
        STRESS                  // high-load / edge-case operational conditions
    }

    /// @dev Level of cybersecurity protection implemented per Art. 15§5
    enum CybersecurityLevel {
        NOT_ASSESSED,   // no assessment performed
        BASIC,          // standard security hygiene (OWASP, input sanitization)
        ENHANCED,       // additional mitigations (rate limiting, anomaly detection)
        HIGH            // full adversarial hardening (model encryption, access controls)
    }

    /// @dev Outcome of an accuracy benchmark evaluation
    enum BenchmarkStatus { PENDING, PASSING, FAILING }

    /// @dev A single accuracy or performance metric benchmark
    struct AccuracyBenchmark {
        uint256         id;
        bytes32         agentId;
        MetricType      metricType;
        string          metricName;      // populated for CUSTOM type; empty otherwise
        uint16          threshold;       // minimum required value, 0–10000 (scaled 1e4)
        uint16          achievedValue;   // measured value, 0–10000
        BenchmarkStatus status;          // PASSING when achievedValue >= threshold
        string          assessmentUri;   // IPFS/Arweave URI to full benchmark report
        address         assessedBy;
        uint256         assessedAt;
    }

    /// @dev One robustness test result
    struct RobustnessTest {
        bytes32             agentId;
        RobustnessTestType  testType;
        bool                passed;
        uint16              degradationRate; // accuracy drop under test, 0–10000 (lower is better)
        string              testUri;         // IPFS/Arweave URI to test report
        address             testedBy;
        uint256             testedAt;
    }

    /// @dev Latest cybersecurity assessment for an agent
    struct CybersecurityAssessment {
        bytes32            agentId;
        CybersecurityLevel level;
        string             threatsAddressed;  // comma-separated threat categories examined
        string             mitigationUri;     // IPFS/Arweave URI to cybersecurity measures doc
        address            assessedBy;
        uint256            assessedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public benchmarkCount;

    mapping(uint256 => AccuracyBenchmark)  private _benchmarks;
    mapping(bytes32  => uint256[])         private _agentBenchmarks;  // agentId → ids
    mapping(bytes32  => RobustnessTest[])  private _robustnessTests;
    mapping(bytes32  => CybersecurityAssessment) private _cybersecurity;
    mapping(bytes32  => bool)              private _hasCybersecurity;

    mapping(bytes32 => address)                       public agentOwner;
    mapping(bytes32 => mapping(address => bool))      public assessors;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgentClaimed(
        bytes32 indexed agentId,
        address         owner,
        uint256         timestamp
    );

    event BenchmarkRecorded(
        uint256 indexed id,
        bytes32 indexed agentId,
        MetricType      metricType,
        uint16          threshold,
        uint16          achievedValue,
        BenchmarkStatus status,
        address         assessedBy,
        uint256         timestamp
    );

    event RobustnessTestRecorded(
        bytes32 indexed    agentId,
        RobustnessTestType testType,
        bool               passed,
        uint16             degradationRate,
        address            testedBy,
        uint256            timestamp
    );

    event CybersecurityAssessed(
        bytes32 indexed    agentId,
        CybersecurityLevel level,
        address            assessedBy,
        uint256            timestamp
    );

    event AssessorSet(
        bytes32 indexed agentId,
        address         assessor,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error NotAuthorized(address caller);
    error AgentAlreadyClaimed(bytes32 agentId);
    error BenchmarkNotFound(uint256 id);
    error InvalidScore(uint16 score);
    error EmptyField();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Agent Ownership ─────────────────────────────────────────────────────

    /// @notice Claim ownership of an agent record — one owner per agentId
    function claimAgent(bytes32 agentId) external {
        if (agentId == bytes32(0))          revert InvalidAgentId();
        if (agentOwner[agentId] != address(0)) revert AgentAlreadyClaimed(agentId);
        agentOwner[agentId] = msg.sender;
        emit AgentClaimed(agentId, msg.sender, block.timestamp);
    }

    /// @notice Authorize or revoke an assessor for a specific agent
    function setAssessor(bytes32 agentId, address assessor, bool authorized) external {
        if (!_isOwner(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        assessors[agentId][assessor] = authorized;
        emit AssessorSet(agentId, assessor, authorized, block.timestamp);
    }

    // ─── Accuracy Benchmarks ─────────────────────────────────────────────────

    /// @notice Record an accuracy benchmark evaluation (Art. 15§1–2)
    /// @param agentId        ERC-8004 agent identifier
    /// @param metricType     Metric being evaluated
    /// @param metricName     For CUSTOM type only; empty string for standard types
    /// @param threshold      Minimum required value, 0–10000 (e.g. 9500 = 95%)
    /// @param achievedValue  Measured value, 0–10000
    /// @param assessmentUri  IPFS/Arweave URI to the full benchmark report
    function recordBenchmark(
        bytes32         agentId,
        MetricType      metricType,
        string calldata metricName,
        uint16          threshold,
        uint16          achievedValue,
        string calldata assessmentUri
    ) external returns (uint256 id) {
        if (agentId == bytes32(0))              revert InvalidAgentId();
        if (!_isAssessor(agentId, msg.sender))  revert NotAuthorized(msg.sender);
        if (threshold > 10000)                  revert InvalidScore(threshold);
        if (achievedValue > 10000)              revert InvalidScore(achievedValue);
        if (bytes(assessmentUri).length == 0)   revert EmptyField();
        if (metricType == MetricType.CUSTOM && bytes(metricName).length == 0) revert EmptyField();

        id = ++benchmarkCount;
        BenchmarkStatus status = achievedValue >= threshold
            ? BenchmarkStatus.PASSING
            : BenchmarkStatus.FAILING;

        AccuracyBenchmark storage b = _benchmarks[id];
        b.id            = id;
        b.agentId       = agentId;
        b.metricType    = metricType;
        b.metricName    = metricName;
        b.threshold     = threshold;
        b.achievedValue = achievedValue;
        b.status        = status;
        b.assessmentUri = assessmentUri;
        b.assessedBy    = msg.sender;
        b.assessedAt    = block.timestamp;

        _agentBenchmarks[agentId].push(id);

        emit BenchmarkRecorded(id, agentId, metricType, threshold, achievedValue, status, msg.sender, block.timestamp);
    }

    // ─── Robustness Tests ─────────────────────────────────────────────────────

    /// @notice Record a robustness test result (Art. 15§3)
    /// @param agentId        ERC-8004 agent identifier
    /// @param testType       Category of robustness test
    /// @param passed         Whether the system passed the test
    /// @param degradationRate Accuracy drop under test conditions, 0–10000 (lower is better)
    /// @param testUri        IPFS/Arweave URI to the test report
    function recordRobustnessTest(
        bytes32            agentId,
        RobustnessTestType testType,
        bool               passed,
        uint16             degradationRate,
        string calldata    testUri
    ) external {
        if (agentId == bytes32(0))              revert InvalidAgentId();
        if (!_isAssessor(agentId, msg.sender))  revert NotAuthorized(msg.sender);
        if (degradationRate > 10000)            revert InvalidScore(degradationRate);
        if (bytes(testUri).length == 0)         revert EmptyField();

        _robustnessTests[agentId].push(RobustnessTest({
            agentId:         agentId,
            testType:        testType,
            passed:          passed,
            degradationRate: degradationRate,
            testUri:         testUri,
            testedBy:        msg.sender,
            testedAt:        block.timestamp
        }));

        emit RobustnessTestRecorded(agentId, testType, passed, degradationRate, msg.sender, block.timestamp);
    }

    // ─── Cybersecurity Assessment ─────────────────────────────────────────────

    /// @notice Record a cybersecurity assessment (Art. 15§5) — replaces any previous assessment
    /// @param agentId          ERC-8004 agent identifier
    /// @param level            Cybersecurity protection level achieved
    /// @param threatsAddressed Comma-separated threat categories examined
    /// @param mitigationUri    IPFS/Arweave URI to cybersecurity measures documentation
    function recordCybersecurityAssessment(
        bytes32         agentId,
        CybersecurityLevel level,
        string calldata threatsAddressed,
        string calldata mitigationUri
    ) external {
        if (agentId == bytes32(0))              revert InvalidAgentId();
        if (!_isAssessor(agentId, msg.sender))  revert NotAuthorized(msg.sender);
        if (bytes(threatsAddressed).length == 0) revert EmptyField();
        if (bytes(mitigationUri).length == 0)   revert EmptyField();

        CybersecurityAssessment storage c = _cybersecurity[agentId];
        c.agentId          = agentId;
        c.level            = level;
        c.threatsAddressed = threatsAddressed;
        c.mitigationUri    = mitigationUri;
        c.assessedBy       = msg.sender;
        c.assessedAt       = block.timestamp;

        _hasCybersecurity[agentId] = true;

        emit CybersecurityAssessed(agentId, level, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get all accuracy benchmarks for an agent
    function getBenchmarks(bytes32 agentId) external view returns (AccuracyBenchmark[] memory result) {
        uint256[] storage ids = _agentBenchmarks[agentId];
        result = new AccuracyBenchmark[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = _benchmarks[ids[i]];
        }
    }

    /// @notice Get a single benchmark by ID
    function getBenchmark(uint256 id) external view returns (AccuracyBenchmark memory) {
        if (_benchmarks[id].id == 0) revert BenchmarkNotFound(id);
        return _benchmarks[id];
    }

    /// @notice Get all robustness test results for an agent
    function getRobustnessTests(bytes32 agentId) external view returns (RobustnessTest[] memory) {
        return _robustnessTests[agentId];
    }

    /// @notice Get the latest cybersecurity assessment for an agent
    function getCybersecurityAssessment(bytes32 agentId) external view returns (CybersecurityAssessment memory) {
        return _cybersecurity[agentId];
    }

    /// @notice Returns true when all registered benchmarks are PASSING (requires at least one)
    function meetsAccuracyRequirements(bytes32 agentId) external view returns (bool) {
        uint256[] storage ids = _agentBenchmarks[agentId];
        if (ids.length == 0) return false;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_benchmarks[ids[i]].status != BenchmarkStatus.PASSING) return false;
        }
        return true;
    }

    /// @notice Returns true when at least one robustness test has been recorded and the latest passed
    function meetsRobustnessRequirements(bytes32 agentId) external view returns (bool) {
        RobustnessTest[] storage tests = _robustnessTests[agentId];
        if (tests.length == 0) return false;
        return tests[tests.length - 1].passed;
    }

    /// @notice Returns true when all three Art. 15 components are satisfied
    /// @dev Accuracy: all benchmarks PASSING (≥1 required). Robustness: latest test passed.
    ///      Cybersecurity: assessment present at BASIC or above.
    function isArt15Compliant(bytes32 agentId) external view returns (bool) {
        // accuracy: all benchmarks passing
        uint256[] storage ids = _agentBenchmarks[agentId];
        if (ids.length == 0) return false;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_benchmarks[ids[i]].status != BenchmarkStatus.PASSING) return false;
        }
        // robustness: latest test passed
        RobustnessTest[] storage tests = _robustnessTests[agentId];
        if (tests.length == 0 || !tests[tests.length - 1].passed) return false;
        // cybersecurity: assessed at BASIC or higher
        if (!_hasCybersecurity[agentId]) return false;
        if (_cybersecurity[agentId].level == CybersecurityLevel.NOT_ASSESSED) return false;
        return true;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _isOwner(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller || caller == deployer;
    }

    function _isAssessor(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller
            || assessors[agentId][caller]
            || caller == deployer;
    }
}
