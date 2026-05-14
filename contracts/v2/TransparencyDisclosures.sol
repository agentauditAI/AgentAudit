// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TransparencyDisclosures
/// @notice On-chain transparency obligation registry for AI systems — EU AI Act Art. 50
/// @dev Art. 50 mandates specific disclosures for five categories of AI deployment:
///      §1 — chatbots must inform users they are interacting with an AI;
///      §2 — emotion recognition / biometric categorisation systems must notify subjects;
///      §3 — providers of systems generating synthetic content (audio, image, video, text)
///           must machine-mark outputs as AI-generated;
///      §4 — deployers of deep-fake systems must disclose that content is AI-generated;
///      §5 — deployers of AI-generated text for public-interest purposes must disclose.
///      Each agent registers a disclosure record per category; `isArt50Compliant()` returns
///      true when the agent has at least one COMPLIANT disclosure entry.
/// @custom:article Art. 50 — Transparency obligations for providers and deployers of certain AI systems
/// @custom:article Art. 50§1 — Chatbot disclosure obligation
/// @custom:article Art. 50§2 — Emotion recognition and biometric categorisation disclosure
/// @custom:article Art. 50§3 — Synthetic content machine-readable labelling
/// @custom:article Art. 50§4 — Deep-fake disclosure
/// @custom:article Art. 50§5 — AI-generated text disclosure
contract TransparencyDisclosures {

    // ─── Types ───────────────────────────────────────────────────────────────

    /// @dev The five Art. 50 disclosure categories
    enum DisclosureCategory {
        CHATBOT,                    // §1 — AI identity disclosure for natural-person interaction
        EMOTION_RECOGNITION,        // §2 — notification for emotion/biometric systems
        BIOMETRIC_CATEGORISATION,   // §2 — notification for biometric categorisation
        SYNTHETIC_CONTENT,          // §3 — machine-readable labelling of AI-generated content
        DEEP_FAKE,                  // §4 — deep-fake content disclosure
        AI_TEXT_GENERATION          // §5 — AI-generated text in public-interest contexts
    }

    /// @dev How the disclosure is implemented in the system
    enum DisclosureMethod {
        IN_INTERFACE,           // visible notice in the user interface
        API_FIELD,              // dedicated field in the API response
        WATERMARK,              // perceptual or invisible watermark
        MACHINE_READABLE_LABEL, // C2PA / IPTC machine-readable metadata label
        AUDIO_VISUAL_NOTICE,    // audio/visual announcement (e.g. voice assistant)
        NOTIFICATION            // push notification or separate communication
    }

    /// @dev Compliance status of a disclosure record
    enum DisclosureStatus {
        REGISTERED,   // record created, not yet verified
        COMPLIANT,    // disclosure implementation verified
        EXEMPT,       // lawful exemption applies (Art. 50§4 proviso, law enforcement etc.)
        NON_COMPLIANT // disclosure requirement not met
    }

    struct DisclosureRecord {
        uint256           id;
        bytes32           agentId;
        DisclosureCategory category;
        DisclosureMethod  method;
        DisclosureStatus  status;
        string            implementationUri;  // IPFS/Arweave URI to evidence of disclosure mechanism
        string            exemptionBasis;     // legal basis if EXEMPT (empty otherwise)
        address           registeredBy;
        uint256           registeredAt;
        uint256           updatedAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public immutable deployer;

    uint256 public disclosureCount;

    mapping(uint256 => DisclosureRecord) private _records;
    mapping(bytes32 => uint256[])        private _agentDisclosures; // agentId → ids

    // per-agent authorised registrars
    mapping(bytes32 => address)                       public agentOwner;
    mapping(bytes32 => mapping(address => bool))      public registrars;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgentClaimed(
        bytes32 indexed agentId,
        address         owner,
        uint256         timestamp
    );

    event DisclosureRegistered(
        uint256 indexed    id,
        bytes32 indexed    agentId,
        DisclosureCategory category,
        DisclosureMethod   method,
        address            registeredBy,
        uint256            timestamp
    );

    event DisclosureStatusUpdated(
        uint256 indexed  id,
        DisclosureStatus oldStatus,
        DisclosureStatus newStatus,
        address          by,
        uint256          timestamp
    );

    event DisclosureImplementationUpdated(
        uint256 indexed id,
        string          newUri,
        address         by,
        uint256         timestamp
    );

    event RegistrarSet(
        bytes32 indexed agentId,
        address         registrar,
        bool            authorized,
        uint256         timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InvalidAgentId();
    error AgentAlreadyClaimed(bytes32 agentId);
    error NotAuthorized(address caller);
    error DisclosureNotFound(uint256 id);
    error EmptyField();
    error ExemptionRequiresBasis();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        deployer = msg.sender;
    }

    // ─── Agent Ownership ─────────────────────────────────────────────────────

    /// @notice Claim ownership of an agent record for disclosure management
    function claimAgent(bytes32 agentId) external {
        if (agentId == bytes32(0))               revert InvalidAgentId();
        if (agentOwner[agentId] != address(0))   revert AgentAlreadyClaimed(agentId);
        agentOwner[agentId] = msg.sender;
        emit AgentClaimed(agentId, msg.sender, block.timestamp);
    }

    /// @notice Authorize or revoke a registrar for a specific agent
    function setRegistrar(bytes32 agentId, address registrar, bool authorized) external {
        if (!_isOwner(agentId, msg.sender)) revert NotAuthorized(msg.sender);
        registrars[agentId][registrar] = authorized;
        emit RegistrarSet(agentId, registrar, authorized, block.timestamp);
    }

    // ─── Disclosure Registration ──────────────────────────────────────────────

    /// @notice Register an Art. 50 transparency disclosure for an agent
    /// @param agentId            ERC-8004 agent identifier
    /// @param category           Which Art. 50 disclosure category applies
    /// @param method             How the disclosure is technically implemented
    /// @param implementationUri  IPFS/Arweave URI to evidence of disclosure mechanism
    /// @param exemptionBasis     Legal basis for exemption (required if status is EXEMPT)
    function registerDisclosure(
        bytes32            agentId,
        DisclosureCategory category,
        DisclosureMethod   method,
        string calldata    implementationUri,
        string calldata    exemptionBasis
    ) external returns (uint256 id) {
        if (agentId == bytes32(0))                  revert InvalidAgentId();
        if (!_isRegistrar(agentId, msg.sender))     revert NotAuthorized(msg.sender);
        if (bytes(implementationUri).length == 0)   revert EmptyField();

        id = ++disclosureCount;
        DisclosureRecord storage r = _records[id];
        r.id                = id;
        r.agentId           = agentId;
        r.category          = category;
        r.method            = method;
        r.status            = DisclosureStatus.REGISTERED;
        r.implementationUri = implementationUri;
        r.exemptionBasis    = exemptionBasis;
        r.registeredBy      = msg.sender;
        r.registeredAt      = block.timestamp;
        r.updatedAt         = block.timestamp;

        _agentDisclosures[agentId].push(id);

        emit DisclosureRegistered(id, agentId, category, method, msg.sender, block.timestamp);
    }

    // ─── Status Management ────────────────────────────────────────────────────

    /// @notice Update the compliance status of a disclosure record
    /// @param id             Disclosure record ID
    /// @param newStatus      New status to set
    /// @param exemptionBasis Required when setting status to EXEMPT
    function updateStatus(
        uint256          id,
        DisclosureStatus newStatus,
        string calldata  exemptionBasis
    ) external {
        DisclosureRecord storage r = _loadRecord(id);
        if (!_isRegistrar(r.agentId, msg.sender))                    revert NotAuthorized(msg.sender);
        if (newStatus == DisclosureStatus.EXEMPT && bytes(exemptionBasis).length == 0)
            revert ExemptionRequiresBasis();

        DisclosureStatus old = r.status;
        r.status         = newStatus;
        r.exemptionBasis = exemptionBasis;
        r.updatedAt      = block.timestamp;

        emit DisclosureStatusUpdated(id, old, newStatus, msg.sender, block.timestamp);
    }

    /// @notice Update the implementation evidence URI for a disclosure
    function updateImplementationUri(uint256 id, string calldata newUri) external {
        DisclosureRecord storage r = _loadRecord(id);
        if (!_isRegistrar(r.agentId, msg.sender)) revert NotAuthorized(msg.sender);
        if (bytes(newUri).length == 0)            revert EmptyField();
        r.implementationUri = newUri;
        r.updatedAt         = block.timestamp;
        emit DisclosureImplementationUpdated(id, newUri, msg.sender, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Get a disclosure record by ID
    function getDisclosure(uint256 id) external view returns (DisclosureRecord memory) {
        if (_records[id].id == 0) revert DisclosureNotFound(id);
        return _records[id];
    }

    /// @notice Get all disclosure records for an agent
    function getAgentDisclosures(bytes32 agentId) external view returns (DisclosureRecord[] memory result) {
        uint256[] storage ids = _agentDisclosures[agentId];
        result = new DisclosureRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = _records[ids[i]];
        }
    }

    /// @notice Count disclosures for an agent by status
    function countByStatus(bytes32 agentId, DisclosureStatus status) external view returns (uint256 count) {
        uint256[] storage ids = _agentDisclosures[agentId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (_records[ids[i]].status == status) count++;
        }
    }

    /// @notice Returns true when the agent has at least one COMPLIANT or EXEMPT disclosure
    /// @dev An agent is Art. 50 compliant if every applicable category is either COMPLIANT
    ///      or EXEMPT — this view checks that at least one qualifying record exists.
    function isArt50Compliant(bytes32 agentId) external view returns (bool) {
        uint256[] storage ids = _agentDisclosures[agentId];
        if (ids.length == 0) return false;
        for (uint256 i = 0; i < ids.length; i++) {
            DisclosureStatus s = _records[ids[i]].status;
            if (s == DisclosureStatus.COMPLIANT || s == DisclosureStatus.EXEMPT) return true;
        }
        return false;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _loadRecord(uint256 id) internal view returns (DisclosureRecord storage r) {
        r = _records[id];
        if (r.id == 0) revert DisclosureNotFound(id);
    }

    function _isOwner(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller || caller == deployer;
    }

    function _isRegistrar(bytes32 agentId, address caller) internal view returns (bool) {
        return agentOwner[agentId] == caller
            || registrars[agentId][caller]
            || caller == deployer;
    }
}
