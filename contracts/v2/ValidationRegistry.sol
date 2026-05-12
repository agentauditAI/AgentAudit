// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ValidationRegistry
/// @notice Plug-in validation layer for ZKAuditProof — ERC-8004 Sprint B
contract ValidationRegistry {

    enum ValidationStatus { PENDING, PASSED, FAILED }

    struct ValidationRule {
        uint256 id;
        string  name;
        string  description;
        bool    active;
    }

    struct ValidationResult {
        uint256 id;
        bytes32 agentId;
        uint256 ruleId;
        ValidationStatus status;
        string  evidence;
        address validatedBy;
        uint256 timestamp;
    }

    mapping(uint256 => ValidationRule) public rules;
    mapping(uint256 => ValidationResult) public results;
    mapping(bytes32 => uint256[]) public agentResults;
    mapping(bytes32 => mapping(uint256 => bool)) public agentRulePassed;
    uint256 public ruleCount;
    uint256 public resultCount;
    address public owner;

    event RuleAdded(uint256 indexed id, string name);
    event ValidationSubmitted(uint256 indexed id, bytes32 indexed agentId, uint256 ruleId, ValidationStatus status);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() { owner = msg.sender; }

    function addRule(string calldata name, string calldata description) external onlyOwner returns (uint256) {
        require(bytes(name).length > 0, "Name required");
        uint256 id = ++ruleCount;
        rules[id] = ValidationRule({id: id, name: name, description: description, active: true});
        emit RuleAdded(id, name);
        return id;
    }

    function deactivateRule(uint256 ruleId) external onlyOwner {
        require(rules[ruleId].id != 0, "Rule not found");
        rules[ruleId].active = false;
    }

    function submitValidation(
        bytes32 agentId,
        uint256 ruleId,
        ValidationStatus status,
        string calldata evidence
    ) external returns (uint256) {
        require(agentId != bytes32(0), "Invalid agentId");
        require(rules[ruleId].active, "Rule not active");

        uint256 id = ++resultCount;
        results[id] = ValidationResult({
            id: id,
            agentId: agentId,
            ruleId: ruleId,
            status: status,
            evidence: evidence,
            validatedBy: msg.sender,
            timestamp: block.timestamp
        });

        agentResults[agentId].push(id);
        if (status == ValidationStatus.PASSED) {
            agentRulePassed[agentId][ruleId] = true;
        }

        emit ValidationSubmitted(id, agentId, ruleId, status);
        return id;
    }

    function hasPassedRule(bytes32 agentId, uint256 ruleId) external view returns (bool) {
        return agentRulePassed[agentId][ruleId];
    }

    function getAgentResults(bytes32 agentId) external view returns (uint256[] memory) {
        return agentResults[agentId];
    }

    function getResult(uint256 id) external view returns (ValidationResult memory) {
        return results[id];
    }

    function allRulesPassed(bytes32 agentId) external view returns (bool) {
        for (uint256 i = 1; i <= ruleCount; i++) {
            if (rules[i].active && !agentRulePassed[agentId][i]) {
                return false;
            }
        }
        return true;
    }
}
