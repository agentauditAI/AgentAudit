// SPDX: MIT | AgentAudit AI — a RunLockAI product
// @elizaos/plugin-agentaudit — EU AI Act compliance logging
// Supports: Mantle, Base, Arbitrum One, Optimism, Polygon (5 networks)
// Articles: 9, 11, 12, 13, 14, 19, 26, 50, 72, 73

const { ethers } = require("ethers");

// ─── Network Config ───────────────────────────────────────────────────────────

const NETWORKS = {
  mantle: {
    rpc: "https://rpc.mantle.xyz",
    chainId: 5000,
    auditVault:    "0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b",
    explorer:      "https://explorer.mantle.xyz",
  },
  base: {
    rpc: "https://mainnet.base.org",
    chainId: 8453,
    auditVault:    "0x556C4275EE68869C6874C343d0Cb7Fc3C8910873",
    explorer:      "https://basescan.org",
  },
  arbitrum: {
    rpc: "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    auditVault:    "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    explorer:      "https://arbiscan.io",
  },
  optimism: {
    rpc: "https://mainnet.optimism.io",
    chainId: 10,
    auditVault:    "0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C",
    explorer:      "https://optimistic.etherscan.io",
  },
  polygon: {
    rpc: "https://polygon-rpc.com",
    chainId: 137,
    auditVault:    "0x6fC00423Df95a7caf6fFFDD93169b5C01480de02",
    explorer:      "https://polygonscan.com",
  },
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const AUDIT_VAULT_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash, uint8 riskLevel) external returns (uint256 logIndex)",
  "function logActionBatch(uint256 agentId, string[] actionTypes, bytes32[] payloadHashes, uint8[] riskLevels) external returns (uint256[] logIndexes)",
  "function getLogCount(uint256 agentId) external view returns (uint256)",
  "function getLogs(uint256 agentId) external view returns (tuple(uint256 logIndex, string actionType, bytes32 payloadHash, uint8 riskLevel, uint256 timestamp)[])",
];

const AGENT_REGISTRATION_ABI = [
  "function registerAgent(string name, string complianceLevel, uint256 spendLimit, address auditVault) external returns (uint256 agentId)",
  "function revokeAgent(uint256 agentId) external",
  "function isActive(uint256 agentId) external view returns (bool)",
  "function agents(uint256) external view returns (string name, address operator, uint256 createdAt, string complianceLevel, uint256 spendLimit, address auditVault, bool revoked)",
];

const INCIDENT_REGISTRY_ABI = [
  "function registerIncident(bytes32 agentId, uint8 severity, string description, string evidenceHash, uint256 occurredAt) external returns (uint256 id)",
  "function markReportedToAuthority(uint256 id) external",
  "function isWithinDeadline(uint256 id) external view returns (bool)",
];

const POST_MARKET_MONITOR_ABI = [
  "function enroll(address agent, string systemName, string riskCategory, uint256 reviewIntervalDays) external",
  "function recordMetric(address agent, uint8 metricType, string metricName, int256 value, int256 threshold, string context, bytes32 txRef) external",
  "function recordReview(address agent, int256 complianceScore, string notes) external",
  "function isReviewDue(address agent) external view returns (bool due, uint256 overdueBySeconds)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNetwork() {
  const net = (process.env.AUDIT_NETWORK || "mantle").toLowerCase();
  if (!NETWORKS[net]) throw new Error(`Unknown network: ${net}. Use: ${Object.keys(NETWORKS).join(", ")}`);
  return { name: net, ...NETWORKS[net] };
}

function getWallet() {
  const key = process.env.AUDIT_PRIVATE_KEY;
  if (!key) throw new Error("AUDIT_PRIVATE_KEY not set");
  const network = getNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc);
  return { wallet: new ethers.Wallet(key, provider), network };
}

function hashPayload(content) {
  const str = typeof content === "string" ? content : JSON.stringify(content);
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

function riskLevel(level) {
  const map = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return map[(level || "LOW").toUpperCase()] ?? 0;
}

function log(msg) {
  console.log(`[AgentAudit AI] ${msg}`);
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const agentAuditPlugin = {
  name: "agent-audit",
  description: "AgentAudit AI — On-chain EU AI Act compliance for autonomous agents. 5 networks. Articles 9, 11, 12, 13, 14, 19, 26, 50, 72, 73.",

  actions: [

    // ── Action 1: Register Agent (Art. 13, 26) ─────────────────────────────
    {
      name: "REGISTER_AGENT",
      description: "Register an AI agent on-chain via KYA standard (Art. 13, 26). Creates immutable identity record.",
      similes: ["register agent", "kya register", "agent identity", "onboard agent"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();

          // Use AgentRegistration on Mantle (primary registry)
          const mantleProvider = new ethers.JsonRpcProvider(NETWORKS.mantle.rpc);
          const mantleWallet = wallet.connect(mantleProvider);
          const REGISTRATION_ADDRESS = process.env.AUDIT_REGISTRATION_ADDRESS
            || "0x68769980879414e8f264Ac15a87813E2ABaBaD6e";

          const contract = new ethers.Contract(REGISTRATION_ADDRESS, AGENT_REGISTRATION_ABI, mantleWallet);

          const name           = options?.agentName      || runtime.agentId || "eliza-agent";
          const complianceLevel = options?.compliance    || "limited";
          const spendLimit     = options?.spendLimit     || ethers.parseEther("100");
          const auditVault     = options?.auditVault     || NETWORKS.mantle.auditVault;

          const tx = await contract.registerAgent(name, complianceLevel, spendLimit, auditVault);
          const receipt = await tx.wait();

          log(`Agent registered | TX: ${tx.hash} | Network: mantle`);

          if (callback) callback({
            text: `✅ Agent registered on Mantle Mainnet.\nTX: ${tx.hash}\nExplorer: ${NETWORKS.mantle.explorer}/tx/${tx.hash}`,
            txHash: tx.hash,
            network: "mantle",
          });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Registration error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "Register my agent for EU AI Act compliance" } },
        { user: "agent", content: { text: "Agent registered on Mantle Mainnet. TX: 0xabc..." } },
      ]],
    },

    // ── Action 2: Log Action (Art. 12, 19, 50) ─────────────────────────────
    {
      name: "LOG_AUDIT",
      description: "Log an agent action on-chain for EU AI Act compliance (Art. 12, 19, 50). Immutable tamper-proof record.",
      similes: ["log action", "audit log", "compliance log", "record action", "log to blockchain"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();
          const contract = new ethers.Contract(network.auditVault, AUDIT_VAULT_ABI, wallet);

          const agentId     = options?.agentId    || process.env.AUDIT_AGENT_ID;
          const actionType  = options?.actionType || "MESSAGE";
          const risk        = riskLevel(options?.riskLevel);
          const payloadHash = hashPayload(message.content);

          const tx = await contract.logAction(agentId, actionType, payloadHash, risk);
          await tx.wait();

          log(`Action logged | ${actionType} | TX: ${tx.hash} | Network: ${network.name}`);

          if (callback) callback({
            text: `✅ Action logged on ${network.name}.\nAction: ${actionType}\nRisk: ${options?.riskLevel || "LOW"}\nTX: ${tx.hash}`,
            txHash: tx.hash,
            network: network.name,
            payloadHash,
          });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Log error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "Transfer 100 USDC to 0x123..." } },
        { user: "agent", content: { text: "Action logged to Base Mainnet. TX: 0xabc..." } },
      ]],
    },

    // ── Action 3: Batch Log (Art. 12, 19) ─────────────────────────────────
    {
      name: "LOG_AUDIT_BATCH",
      description: "Log multiple agent actions in a single tx for gas efficiency (Art. 12, 19).",
      similes: ["batch log", "log batch", "multi log", "bulk audit"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();
          const contract = new ethers.Contract(network.auditVault, AUDIT_VAULT_ABI, wallet);

          const agentId = options?.agentId || process.env.AUDIT_AGENT_ID;
          const actions = options?.actions || [];

          if (!actions.length) throw new Error("No actions provided for batch log");

          const actionTypes  = actions.map(a => a.type || "ACTION");
          const payloadHashes = actions.map(a => hashPayload(a.payload || a));
          const riskLevels   = actions.map(a => riskLevel(a.riskLevel));

          const tx = await contract.logActionBatch(agentId, actionTypes, payloadHashes, riskLevels);
          await tx.wait();

          log(`Batch logged | ${actions.length} actions | TX: ${tx.hash} | Network: ${network.name}`);

          if (callback) callback({
            text: `✅ Batch logged ${actions.length} actions on ${network.name}.\nTX: ${tx.hash}`,
            txHash: tx.hash,
            count: actions.length,
          });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Batch log error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "Log my last 5 actions" } },
        { user: "agent", content: { text: "5 actions logged to Arbitrum One. TX: 0xabc..." } },
      ]],
    },

    // ── Action 4: Report Incident (Art. 73) ────────────────────────────────
    {
      name: "REPORT_INCIDENT",
      description: "Report an AI incident to the on-chain registry (Art. 73). Enforces 15/10/2 day reporting timelines.",
      similes: ["report incident", "incident report", "flag issue", "report problem", "art 73"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_INCIDENT_REGISTRY;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();
          const REGISTRY = process.env.AUDIT_INCIDENT_REGISTRY;
          const contract = new ethers.Contract(REGISTRY, INCIDENT_REGISTRY_ABI, wallet);

          const agentId     = options?.agentId     || ethers.id(process.env.AUDIT_AGENT_ID || "agent");
          const severity    = options?.severity     || 1; // 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
          const description = options?.description  || message.content?.text || "Incident reported";
          const evidenceHash = options?.evidenceHash || hashPayload(description);
          const occurredAt  = options?.occurredAt   || Math.floor(Date.now() / 1000);

          const tx = await contract.registerIncident(agentId, severity, description, evidenceHash, occurredAt);
          await tx.wait();

          log(`Incident reported | Severity: ${severity} | TX: ${tx.hash}`);

          if (callback) callback({
            text: `✅ Incident registered on-chain.\nSeverity: ${["LOW","MEDIUM","HIGH","CRITICAL"][severity]}\nTX: ${tx.hash}\nArt. 73 timeline enforcement active.`,
            txHash: tx.hash,
          });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Incident error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "Report a high severity incident with the agent" } },
        { user: "agent", content: { text: "Incident registered on-chain. Art. 73 timeline enforcement active." } },
      ]],
    },

    // ── Action 5: Post-Market Monitor (Art. 72) ────────────────────────────
    {
      name: "RECORD_METRIC",
      description: "Record a post-market monitoring metric (Art. 72). Tracks performance, drift, compliance scores.",
      similes: ["record metric", "monitor performance", "post market", "compliance score", "art 72"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_MONITOR_ADDRESS;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();
          const MONITOR = process.env.AUDIT_MONITOR_ADDRESS;
          const contract = new ethers.Contract(MONITOR, POST_MARKET_MONITOR_ABI, wallet);

          const agent      = options?.agentAddress || wallet.address;
          const metricType = options?.metricType   || 3; // 3 = COMPLIANCE_SCORE
          const metricName = options?.metricName   || "compliance_score";
          const value      = options?.value        || 9000;
          const threshold  = options?.threshold    || 8000;
          const context    = options?.context      || "auto";
          const txRef      = options?.txRef        || ethers.ZeroHash;

          const tx = await contract.recordMetric(agent, metricType, metricName, value, threshold, context, txRef);
          await tx.wait();

          log(`Metric recorded | ${metricName}: ${value} | TX: ${tx.hash}`);

          if (callback) callback({
            text: `✅ Metric recorded on-chain.\n${metricName}: ${value} (threshold: ${threshold})\nTX: ${tx.hash}`,
            txHash: tx.hash,
          });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Metric error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "Record compliance score 95%" } },
        { user: "agent", content: { text: "Compliance score 9500 recorded on-chain. TX: 0xabc..." } },
      ]],
    },

    // ── Action 6: Status Check ─────────────────────────────────────────────
    {
      name: "AUDIT_STATUS",
      description: "Check AgentAudit AI status: log count, network, compliance score.",
      similes: ["audit status", "check compliance", "log count", "audit info"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const { wallet, network } = getWallet();
          const contract = new ethers.Contract(network.auditVault, AUDIT_VAULT_ABI, wallet);

          const agentId = options?.agentId || process.env.AUDIT_AGENT_ID;
          const count = await contract.getLogCount(agentId);

          const status = `AgentAudit AI Status\nNetwork: ${network.name}\nAgent ID: ${agentId}\nLogs on-chain: ${count.toString()}\nExplorer: ${network.explorer}`;

          log(status);
          if (callback) callback({ text: status, count: count.toString(), network: network.name });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Status error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "What's the audit status?" } },
        { user: "agent", content: { text: "AgentAudit AI Status\nNetwork: base\nLogs on-chain: 142" } },
      ]],
    },
  ],

  // ── Auto-log middleware ────────────────────────────────────────────────────
  // Attach to runtime to auto-log every agent action
  middleware: async (runtime, message, state, next) => {
    if (process.env.AUDIT_AUTO_LOG === "true" && process.env.AUDIT_AGENT_ID) {
      try {
        const { wallet, network } = getWallet();
        const contract = new ethers.Contract(network.auditVault, AUDIT_VAULT_ABI, wallet);
        const agentId = process.env.AUDIT_AGENT_ID;
        const payloadHash = hashPayload(message.content);
        const tx = await contract.logAction(agentId, "AUTO_LOG", payloadHash, 0);
        log(`Auto-logged | TX: ${tx.hash}`);
      } catch (e) {
        // Silent fail — don't block agent
      }
    }
    return next();
  },
};

// ─── .env example (print if no key set) ──────────────────────────────────────

if (!process.env.AUDIT_PRIVATE_KEY) {
  console.warn(`
[AgentAudit AI] Missing env vars. Add to your .env:

AUDIT_PRIVATE_KEY=0x...          # Agent wallet private key
AUDIT_AGENT_ID=1                 # Your registered agent ID
AUDIT_NETWORK=base               # mantle | base | arbitrum | optimism | polygon
AUDIT_AUTO_LOG=false             # true = auto-log every action
AUDIT_INCIDENT_REGISTRY=0x...   # IncidentRegistry contract address (Art. 73)
AUDIT_MONITOR_ADDRESS=0x...     # PostMarketMonitor contract address (Art. 72)
`);
}

module.exports = agentAuditPlugin;
