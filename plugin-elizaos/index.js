const { ethers } = require("ethers");

// AgentRegistration v2 ABI
const REGISTRATION_ABI = [
  "function registerAgent(string name, string complianceLevel, uint256 spendLimit, address auditVault) external returns (uint256 agentId)",
  "function revokeAgent(uint256 agentId) external",
  "function isActive(uint256 agentId) external view returns (bool)",
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)"
];

// AgentAuditBatch v2 ABI
const AUDIT_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash) external",
  "function logActionBatch(uint256 agentId, string[] actionTypes, bytes32[] payloadHashes) external",
  "function getLogCount(uint256 agentId) external view returns (uint256)"
];

const MANTLE_RPC = "https://rpc.mantle.xyz";
const REGISTRATION_ADDRESS = "0x68769980879414e8f264Ac15a87813E2ABaBaD6e";
const AUDIT_BATCH_ADDRESS = "0xAF9ccA0C3D79900576557329F57824A0e277";
const AUDIT_VAULT_V1 = "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b";

const agentAuditPlugin = {
  name: "agent-audit",
  description: "Logs AI agent actions to AgentAudit smart contracts on Mantle Mainnet for EU AI Act compliance (Articles 9, 12, 13, 19, 26, 72)",

  actions: [
    {
      name: "REGISTER_AGENT",
      description: "Register an AI agent on-chain via KYA standard (Know Your Agent)",
      similes: ["register agent", "kya register", "agent identity"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
          const wallet = new ethers.Wallet(process.env.AUDIT_PRIVATE_KEY, provider);
          const contract = new ethers.Contract(REGISTRATION_ADDRESS, REGISTRATION_ABI, wallet);

          const name = options?.agentName || runtime.agentId || "unknown-agent";
          const complianceLevel = options?.complianceLevel || "limited";
          const spendLimit = options?.spendLimit || ethers.parseEther("100");
          const auditVault = options?.auditVault || AUDIT_VAULT_V1;

          const tx = await contract.registerAgent(name, complianceLevel, spendLimit, auditVault);
          await tx.wait();

          console.log(`[AgentAudit] Agent registered. TX: ${tx.hash}`);

          if (callback) {
            callback({
              text: `Agent registered on Mantle Mainnet. TX: ${tx.hash}`,
              txHash: tx.hash
            });
          }

          return true;
        } catch (error) {
          console.error("[AgentAudit] Registration error:", error);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [
        [
          { user: "user", content: { text: "Register my agent" } },
          { user: "agent", content: { text: "Agent registered on Mantle Mainnet. TX: 0xabc..." } }
        ]
      ]
    },

    {
      name: "LOG_AUDIT",
      description: "Log an agent action to the blockchain for EU AI Act compliance",
      similes: ["log action", "audit log", "compliance log", "record action"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
          const wallet = new ethers.Wallet(process.env.AUDIT_PRIVATE_KEY, provider);
          const contract = new ethers.Contract(AUDIT_BATCH_ADDRESS, AUDIT_ABI, wallet);

          const agentId = options?.agentId || process.env.AUDIT_AGENT_ID;
          const actionType = options?.actionType || "MESSAGE";
          const payload = typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);
          const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));

          const tx = await contract.logAction(agentId, actionType, payloadHash);
          await tx.wait();

          console.log(`[AgentAudit] Logged to blockchain: ${tx.hash}`);

          if (callback) {
            callback({
              text: `Action logged to Mantle Mainnet. TX: ${tx.hash}`,
              txHash: tx.hash
            });
          }

          return true;
        } catch (error) {
          console.error("[AgentAudit] Error logging action:", error);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [
        [
          { user: "user", content: { text: "Transfer 100 USDC to 0x123..." } },
          { user: "agent", content: { text: "Action logged to Mantle Mainnet. TX: 0xabc..." } }
        ]
      ]
    }
  ]
};

module.exports = agentAuditPlugin;