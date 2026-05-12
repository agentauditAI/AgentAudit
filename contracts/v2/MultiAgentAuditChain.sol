// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MultiAgentAuditChain
/// @notice Chains audit records across multiple cooperating agents — EU AI Act Art. 9 + Art. 12
contract MultiAgentAuditChain {

    struct ChainEntry {
        uint256 id;
        bytes32 chainId;
        bytes32 agentId;
        bytes32 prevEntryHash;
        bytes32 dataHash;
        string  action;
        address submittedBy;
        uint256 timestamp;
        uint256 sequenceNum;
    }

    struct AuditChain {
        bytes32 chainId;
        bytes32 rootAgentId;
        uint256 entryCount;
        uint256 createdAt;
        bool    finalized;
    }

    mapping(bytes32 => AuditChain) public chains;
    mapping(uint256 => ChainEntry) public entries;
    mapping(bytes32 => uint256[]) public chainEntries;
    uint256 public entryCount;

    event ChainCreated(bytes32 indexed chainId, bytes32 indexed rootAgentId, uint256 timestamp);
    event EntryAdded(uint256 indexed id, bytes32 indexed chainId, bytes32 agentId, uint256 seqNum);
    event ChainFinalized(bytes32 indexed chainId, uint256 timestamp);

    function createChain(bytes32 chainId, bytes32 rootAgentId) external {
        require(chainId != bytes32(0), "Invalid chainId");
        require(chains[chainId].createdAt == 0, "Chain already exists");
        chains[chainId] = AuditChain({
            chainId: chainId,
            rootAgentId: rootAgentId,
            entryCount: 0,
            createdAt: block.timestamp,
            finalized: false
        });
        emit ChainCreated(chainId, rootAgentId, block.timestamp);
    }

    function addEntry(
        bytes32 chainId,
        bytes32 agentId,
        bytes32 dataHash,
        string calldata action
    ) external returns (uint256) {
        require(chains[chainId].createdAt != 0, "Chain not found");
        require(!chains[chainId].finalized, "Chain finalized");

        uint256[] memory existing = chainEntries[chainId];
        bytes32 prevHash = existing.length > 0
            ? _entryHash(entries[existing[existing.length - 1]])
            : bytes32(0);

        uint256 id = ++entryCount;
        uint256 seqNum = ++chains[chainId].entryCount;

        entries[id] = ChainEntry({
            id: id,
            chainId: chainId,
            agentId: agentId,
            prevEntryHash: prevHash,
            dataHash: dataHash,
            action: action,
            submittedBy: msg.sender,
            timestamp: block.timestamp,
            sequenceNum: seqNum
        });

        chainEntries[chainId].push(id);
        emit EntryAdded(id, chainId, agentId, seqNum);
        return id;
    }

    function finalizeChain(bytes32 chainId) external {
        require(chains[chainId].createdAt != 0, "Chain not found");
        require(!chains[chainId].finalized, "Already finalized");
        chains[chainId].finalized = true;
        emit ChainFinalized(chainId, block.timestamp);
    }

    function getChainEntries(bytes32 chainId) external view returns (uint256[] memory) {
        return chainEntries[chainId];
    }

    function getEntry(uint256 id) external view returns (ChainEntry memory) {
        return entries[id];
    }

    function verifyChainIntegrity(bytes32 chainId) external view returns (bool) {
        uint256[] memory ids = chainEntries[chainId];
        if (ids.length == 0) return true;
        for (uint256 i = 1; i < ids.length; i++) {
            if (entries[ids[i]].prevEntryHash != _entryHash(entries[ids[i-1]])) {
                return false;
            }
        }
        return true;
    }

    function _entryHash(ChainEntry memory e) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(e.id, e.chainId, e.agentId, e.dataHash, e.timestamp));
    }
}
