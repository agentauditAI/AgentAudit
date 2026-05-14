// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ConformityAssessment
/// @notice On-chain EU conformity assessment registry — EU AI Act Articles 43, 44, and 22
/// @dev Records conformity assessments and EU Declarations of Conformity for high-risk AI
///      systems prior to market placement. Supports both self-assessment (Art. 43§2,
///      internal control procedure for most Annex III systems) and notified-body assessment
///      (Art. 43§1, mandatory for biometric identification systems). Certificates issued
///      by notified bodies are valid for a maximum of 5 years (Art. 44§1); the contract
///      enforces this ceiling and exposes `checkExpiry()` for post-market enforcement.
/// @custom:article Art. 22 — EU Declaration of Conformity
/// @custom:article Art. 43 — Conformity assessment procedures for high-risk AI systems
/// @custom:article Art. 44 — Certificates issued by notified bodies (max 5 years)
contract ConformityAssessment {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev Art. 43 assessment route
    enum AssessmentType {
        SELF_ASSESSMENT,   // Art. 43§2 — internal control procedure
        NOTIFIED_BODY      // Art. 43§1 — third-party assessment (biometric ID systems)
    }

    /// @dev Lifecycle status of the conformity record
    enum ConformityStatus {
        PENDING,      // registered, assessment not yet completed
        CERTIFIED,    // EU Declaration of Conformity issued
        WITHDRAWN,    // certification voluntarily withdrawn by provider
        EXPIRED       // past validUntil or certificate revoked
    }

    /// @dev Input parameters for register() — grouped to avoid stack-too-deep
    struct RegisterParams {
        bytes32        agentId;           // ERC-8004 agent identifier
        AssessmentType assessmentType;
        string         providerName;      // Art. 22 — provider name and address
        string         providerAddress;   // Art. 22 — provider registered address
        string         systemDescription; // Art. 22 — AI system description
        string         notifiedBodyName;  // Art. 44 — notified body name (if applicable)
        string         notifiedBodyRef;   // Art. 44 — notified body identification number
        string         certificateRef;    // Art. 44 — certificate reference number
        string         standardsApplied; // harmonised standards / common specifications applied
        string         declarationUri;   // IPFS/Arweave URI to full EU Declaration of Conformity
        uint256        validFrom;         // start of validity period
        uint256        validUntil;        // end of validity period (max validFrom + MAX_VALIDITY)
    }

    struct ConformityRecord {
        bytes32        agentId;
        AssessmentType assessmentType;
        ConformityStatus status;
        string         providerName;
        string         providerAddress;
        string         systemDescription;
        string         notifiedBodyName;
        string         notifiedBodyRef;
        string         certificateRef;
        string         standardsApplied;
        string         declarationUri;
        uint256        validFrom;
        uint256        validUntil;
        address        registeredBy;
        uint256        registeredAt;
        uint256        updatedAt;
        string         withdrawalReason;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    /// @dev Art. 44§1 — maximum certificate validity: 5 years
    uint256 public constant MAX_VALIDITY = 1825 days;

    mapping(bytes32 => ConformityRecord) private _records;
    mapping(bytes32 => bool)             private _exists;
    bytes32[]                            private _registeredAgents;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ConformityRegistered(
        bytes32 indexed agentId,
        AssessmentType  assessmentType,
        string          declarationUri,
        uint256         validUntil,
        address         registeredBy,
        uint256         timestamp
    );

    event ConformityCertified(
        bytes32 indexed agentId,
        address         by,
        uint256         timestamp
    );

    event ConformityWithdrawn(
        bytes32 indexed agentId,
        address         by,
        string          reason,
        uint256         timestamp
    );

    event ConformityExpired(
        bytes32 indexed agentId,
        uint256         expiredAt,
        uint256         timestamp
    );

    event DeclarationUpdated(
        bytes32 indexed agentId,
        string          newDeclarationUri,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error AlreadyRegistered(bytes32 agentId);
    error NotFound(bytes32 agentId);
    error NotAuthorized(address caller);
    error AlreadyCertified(bytes32 agentId);
    error AlreadyWithdrawn(bytes32 agentId);
    error AlreadyExpired(bytes32 agentId);
    error InvalidValidityPeriod(uint256 validFrom, uint256 validUntil);
    error ExceedsMaxValidity(uint256 duration, uint256 max);
    error NotifiedBodyRequired();
    error EmptyField();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /// @notice Register a conformity assessment record (Art. 43)
    /// @dev For NOTIFIED_BODY assessments, notifiedBodyName and notifiedBodyRef are required.
    ///      The declarationUri must point to the full Art. 22 EU Declaration document on IPFS/Arweave.
    function register(RegisterParams calldata p) external {
        if (p.agentId == bytes32(0))                   revert InvalidAgentId();
        if (_exists[p.agentId])                        revert AlreadyRegistered(p.agentId);
        if (bytes(p.providerName).length == 0)         revert EmptyField();
        if (bytes(p.declarationUri).length == 0)       revert EmptyField();
        if (p.validUntil <= p.validFrom)               revert InvalidValidityPeriod(p.validFrom, p.validUntil);
        if (p.validUntil - p.validFrom > MAX_VALIDITY) revert ExceedsMaxValidity(p.validUntil - p.validFrom, MAX_VALIDITY);
        if (p.assessmentType == AssessmentType.NOTIFIED_BODY) {
            if (bytes(p.notifiedBodyName).length == 0) revert NotifiedBodyRequired();
            if (bytes(p.notifiedBodyRef).length == 0)  revert NotifiedBodyRequired();
        }

        ConformityRecord storage r = _records[p.agentId];
        r.agentId          = p.agentId;
        r.assessmentType   = p.assessmentType;
        r.status           = ConformityStatus.PENDING;
        r.providerName     = p.providerName;
        r.providerAddress  = p.providerAddress;
        r.systemDescription = p.systemDescription;
        r.notifiedBodyName = p.notifiedBodyName;
        r.notifiedBodyRef  = p.notifiedBodyRef;
        r.certificateRef   = p.certificateRef;
        r.standardsApplied = p.standardsApplied;
        r.declarationUri   = p.declarationUri;
        r.validFrom        = p.validFrom;
        r.validUntil       = p.validUntil;
        r.registeredBy     = msg.sender;
        r.registeredAt     = block.timestamp;
        r.updatedAt        = block.timestamp;

        _exists[p.agentId] = true;
        _registeredAgents.push(p.agentId);

        emit ConformityRegistered(
            p.agentId, p.assessmentType, p.declarationUri,
            p.validUntil, msg.sender, block.timestamp
        );
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// @notice Certify — issue the EU Declaration of Conformity (Art. 22)
    /// @dev Advances status from PENDING to CERTIFIED. Can only be called by registeredBy
    ///      or deployer; represents the formal act of signing the declaration.
    function certify(bytes32 agentId) external {
        ConformityRecord storage r = _load(agentId);
        if (!_isAuthorized(r, msg.sender))           revert NotAuthorized(msg.sender);
        if (r.status == ConformityStatus.CERTIFIED)  revert AlreadyCertified(agentId);
        if (r.status == ConformityStatus.WITHDRAWN)  revert AlreadyWithdrawn(agentId);
        if (r.status == ConformityStatus.EXPIRED)    revert AlreadyExpired(agentId);

        r.status    = ConformityStatus.CERTIFIED;
        r.updatedAt = block.timestamp;

        emit ConformityCertified(agentId, msg.sender, block.timestamp);
    }

    /// @notice Withdraw the EU Declaration of Conformity (voluntary)
    function withdraw(bytes32 agentId, string calldata reason) external {
        ConformityRecord storage r = _load(agentId);
        if (!_isAuthorized(r, msg.sender))          revert NotAuthorized(msg.sender);
        if (r.status == ConformityStatus.WITHDRAWN) revert AlreadyWithdrawn(agentId);
        if (r.status == ConformityStatus.EXPIRED)   revert AlreadyExpired(agentId);
        if (bytes(reason).length == 0)              revert EmptyField();

        r.status          = ConformityStatus.WITHDRAWN;
        r.withdrawalReason = reason;
        r.updatedAt       = block.timestamp;

        emit ConformityWithdrawn(agentId, msg.sender, reason, block.timestamp);
    }

    /// @notice Mark a record as expired if past its validUntil timestamp (Art. 44§1)
    /// @dev Anyone can call this — it is a permissionless state update reflecting reality.
    function checkExpiry(bytes32 agentId) external {
        ConformityRecord storage r = _load(agentId);
        if (r.status == ConformityStatus.EXPIRED)   revert AlreadyExpired(agentId);
        if (r.status == ConformityStatus.WITHDRAWN) revert AlreadyWithdrawn(agentId);
        if (block.timestamp <= r.validUntil)        revert InvalidValidityPeriod(block.timestamp, r.validUntil);

        r.status    = ConformityStatus.EXPIRED;
        r.updatedAt = block.timestamp;

        emit ConformityExpired(agentId, r.validUntil, block.timestamp);
    }

    /// @notice Update the URI to the EU Declaration of Conformity document
    /// @dev Used when a revised declaration is issued (e.g. after a substantial modification)
    function updateDeclaration(bytes32 agentId, string calldata newDeclarationUri) external {
        ConformityRecord storage r = _load(agentId);
        if (!_isAuthorized(r, msg.sender))          revert NotAuthorized(msg.sender);
        if (r.status == ConformityStatus.WITHDRAWN) revert AlreadyWithdrawn(agentId);
        if (r.status == ConformityStatus.EXPIRED)   revert AlreadyExpired(agentId);
        if (bytes(newDeclarationUri).length == 0)   revert EmptyField();

        r.declarationUri = newDeclarationUri;
        r.updatedAt      = block.timestamp;

        emit DeclarationUpdated(agentId, newDeclarationUri, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Returns true if the agent has a CERTIFIED, non-expired conformity record
    function isValid(bytes32 agentId) external view returns (bool) {
        if (!_exists[agentId]) return false;
        ConformityRecord storage r = _records[agentId];
        return r.status == ConformityStatus.CERTIFIED && block.timestamp <= r.validUntil;
    }

    /// @notice Get the full conformity record for an agent
    function getRecord(bytes32 agentId) external view returns (ConformityRecord memory) {
        if (!_exists[agentId]) revert NotFound(agentId);
        return _records[agentId];
    }

    /// @notice Get all registered agent IDs
    function getRegisteredAgents() external view returns (bytes32[] memory) {
        return _registeredAgents;
    }

    /// @notice Get the total number of registered conformity records
    function getRegisteredCount() external view returns (uint256) {
        return _registeredAgents.length;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _load(bytes32 agentId) internal view returns (ConformityRecord storage r) {
        if (!_exists[agentId]) revert NotFound(agentId);
        r = _records[agentId];
    }

    function _isAuthorized(ConformityRecord storage r, address caller) internal view returns (bool) {
        return r.registeredBy == caller || caller == deployer;
    }
}
