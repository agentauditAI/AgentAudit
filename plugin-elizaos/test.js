require("dotenv").config();
const { ethers } = require("ethers");
const plugin = require("./index.js");

const ABI = [
  "function registerAgent(bytes32 agentId, string calldata metadata) external",
  "function logAction(bytes32 agentId, bytes32 sessionId, string actionType, string payload) external"
];

async function test() {
  console.log("Testing AgentAudit ElizaOS Plugin...");

  // Rejestracja agenta
  const provider = new ethers.JsonRpcProvider(process.env.AUDIT_RPC_URL);
  const wallet = new ethers.Wallet(process.env.AUDIT_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.AUDIT_CONTRACT_ADDRESS, ABI, wallet);

  const agentId = ethers.encodeBytes32String("test-agent-001");

  console.log("Registering agent...");
  try {
    const tx = await contract.registerAgent(agentId, "ElizaOS test agent");
    await tx.wait();
    console.log("Agent registered! TX:", tx.hash);
  } catch (e) {
    console.log("Agent may already be registered:", e.reason || e.message);
  }

  // Test pluginu
  const runtime = { agentId: "test-agent-001" };
  const message = {
    roomId: "test-session-001",
    content: { text: "Transfer 50 USDC to 0xabc123" }
  };

  const isValid = await plugin.actions[0].validate(runtime, message);
  console.log("Validation:", isValid ? "PASS" : "FAIL - check .env file");

  if (isValid) {
    console.log("Sending transaction to Arbitrum Sepolia...");
    await plugin.actions[0].handler(runtime, message, {}, {}, (result) => {
      console.log("Result:", result);
    });
  }
}

test().catch(console.error);