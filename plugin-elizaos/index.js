const { ethers } = require("ethers");

const ABI = [
  "function logAction(bytes32 agentId, bytes32 sessionId, string actionType, string payload) external",
  "function getAuditLogCount(bytes32 agentId) external view returns (uint256)",
  "function getAuditEntry(bytes32 agentId, uint256 index) external view returns (tuple(bytes32 agentId, bytes32 sessionId, address caller, string actionType, string payload, uint256 timestamp, uint256 blockNumber))"
];

const agentAuditPlugin = {
  name: "agent-audit",
  description: "Logs AI agent actions to AgentAudit smart contract on Arbitrum for EU AI Act compliance",
  
  actions: [
    {
      name: "LOG_AUDIT",
      description: "Log an agent action to the blockchain for compliance",
      similes: ["log action", "audit log", "compliance log", "record action"],
      
      validate: async (runtime, message) => {
        const hasContract = !!process.env.AUDIT_CONTRACT_ADDRESS;
        const hasKey = !!process.env.AUDIT_PRIVATE_KEY;
        const hasRpc = !!process.env.AUDIT_RPC_URL;
        return hasContract && hasKey && hasRpc;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const provider = new ethers.JsonRpcProvider(process.env.AUDIT_RPC_URL);
          const wallet = new ethers.Wallet(process.env.AUDIT_PRIVATE_KEY, provider);
          const contract = new ethers.Contract(process.env.AUDIT_CONTRACT_ADDRESS, ABI, wallet);

          const agentId = ethers.encodeBytes32String(
            options?.agentId || runtime.agentId || "unknown-agent"
          );
          const sessionId = ethers.encodeBytes32String(
            options?.sessionId || message.roomId || "unknown-session"
          );
          const actionType = options?.actionType || "MESSAGE";
          const payload = typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);

          const tx = await contract.logAction(agentId, sessionId, actionType, payload);
          await tx.wait();

          console.log(`[AgentAudit] Logged to blockchain: ${tx.hash}`);

          if (callback) {
            callback({
              text: `Action logged to blockchain. TX: ${tx.hash}`,
              txHash: tx.hash
            });
          }

          return true;
        } catch (error) {
          console.error("[AgentAudit] Error logging action:", error);
          if (callback) {
            callback({ text: `AgentAudit error: ${error.message}` });
          }
          return false;
        }
      },

      examples: [
        [
          { user: "user", content: { text: "Transfer 100 USDC to 0x123..." } },
          { user: "agent", content: { text: "Action logged to blockchain. TX: 0xabc..." } }
        ]
      ]
    }
  ]
};

module.exports = agentAuditPlugin;