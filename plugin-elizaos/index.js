// SPDX: MIT | AgentAudit AI — a RunLockAI product
// @elizaos/plugin-agentaudit — EU AI Act compliance logging
// Supports: Mantle, Base, Arbitrum One, Optimism, Polygon (5 networks)
// Articles: 9, 11, 12, 13, 14, 19, 26, 50, 72, 73
//
// Audit logs are batch-anchored through @agentauditai/sdk: each logged action
// becomes one action_ref (docs/EVIDENCE_SCHEMA.md), and a BatchBuffer anchors
// one Merkle root per batch via AuditVault v2 commitBatch.

const { ethers } = require("ethers");
const {
  AgentAudit,
  NETWORKS,
  BatchBuffer,
  FileBatchStore,
  canonicalize,
  sha256Hex,
} = require("@agentauditai/sdk");

const PLUGIN_ID = "agentaudit-elizaos/1.1";
const DEFAULT_BATCH_DIR = "./agentaudit-batches";

// ─── ABIs (contracts the SDK does not cover with identical semantics) ────────

const INCIDENT_REGISTRY_ABI = [
  "function registerIncident(bytes32 agentId, uint8 severity, string description, string evidenceHash, uint256 occurredAt) external returns (uint256 id)",
];

const POST_MARKET_MONITOR_ABI = [
  "function recordMetric(address agent, uint8 metricType, string metricName, int256 value, int256 threshold, string context, bytes32 txRef) external",
];

const AUDIT_VAULT_V2_READ_ABI = [
  "function getBatchCount(address agentId) external view returns (uint256)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNetwork() {
  const net = (process.env.AUDIT_NETWORK || "mantle").toLowerCase();
  if (!NETWORKS[net]) throw new Error(`Unknown network: ${net}. Use: ${Object.keys(NETWORKS).join(", ")}`);
  return {
    ...NETWORKS[net],
    name: net,
    rpc: process.env.AUDIT_RPC_URL || NETWORKS[net].rpc,
    auditVault: process.env.AUDIT_VAULT_ADDRESS || NETWORKS[net].auditVault,
  };
}

function getWallet() {
  const key = process.env.AUDIT_PRIVATE_KEY;
  if (!key) throw new Error("AUDIT_PRIVATE_KEY not set");
  const network = getNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc);
  return { wallet: new ethers.Wallet(key, provider), network };
}

// One SDK client + batch buffer per configuration; rebuilt if the env changes
let _ctx = null;

function getContext() {
  const key = process.env.AUDIT_PRIVATE_KEY;
  if (!key) throw new Error("AUDIT_PRIVATE_KEY not set");
  const network = getNetwork();
  const vaultOverride = process.env.AUDIT_VAULT_ADDRESS || undefined;
  const batchDir = process.env.AUDIT_BATCH_DIR || DEFAULT_BATCH_DIR;
  const id = [key, network.name, network.rpc, vaultOverride, batchDir].join("|");
  if (_ctx && _ctx.id === id) return _ctx;

  const sdk = new AgentAudit({
    privateKey: key,
    network: network.name,
    rpcUrl: network.rpc,
    auditVaultAddress: vaultOverride,
  });
  _ctx = { id, sdk, network, batchDir, buffer: null };
  return _ctx;
}

function getBuffer() {
  const ctx = getContext();
  if (!ctx.buffer) {
    // Clear error on networks without AuditVault v2 (unless AUDIT_VAULT_ADDRESS is set)
    ctx.sdk.assertBatchAnchoring();
    ctx.buffer = new BatchBuffer({
      committer: ctx.sdk,
      agentAddress: ctx.sdk.getAddress(),
      store: new FileBatchStore(ctx.batchDir),
      onError: (err) => console.error("[AgentAudit] batch flush failed:", err.message),
    });
  }
  return ctx.buffer;
}

/** sha256 of the message content — raw content never leaves the process */
function hashContent(content) {
  const str = typeof content === "string" ? content : canonicalize(content ?? null);
  return "sha256:" + sha256Hex(str);
}

function riskName(level) {
  const upper = (level || "LOW").toUpperCase();
  return ["LOW", "MEDIUM", "HIGH"].includes(upper) ? upper : "LOW";
}

/** Hashed audit record + its preimage (scope §2.5 agent_action) */
function auditEntry(agentId, actionType, risk, payloadHash) {
  const record = { plugin: PLUGIN_ID, action_type: actionType, risk_level: risk, payload_hash: payloadHash };
  const preimage = {
    action_type: actionType,
    agent_id: String(agentId),
    scope: `agent_action:elizaos:record_hash:${sha256Hex(canonicalize(record))}`,
    timestamp_ms: Date.now(),
  };
  return { preimage, record };
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
          const key = process.env.AUDIT_PRIVATE_KEY;
          if (!key) throw new Error("AUDIT_PRIVATE_KEY not set");
          getNetwork(); // validate AUDIT_NETWORK

          // AgentRegistration lives on Mantle (primary registry)
          const registry = new AgentAudit({
            privateKey: key,
            network: "mantle",
            registrationAddress: process.env.AUDIT_REGISTRATION_ADDRESS || undefined,
          });

          const { txHash } = await registry.registerAgent({
            name:            options?.agentName  || runtime.agentId || "eliza-agent",
            complianceLevel: options?.compliance || "limited",
            spendLimit:      options?.spendLimit || undefined,
            auditVault:      options?.auditVault || undefined,
          });

          log(`Agent registered | TX: ${txHash} | Network: mantle`);

          if (callback) callback({
            text: `✅ Agent registered on Mantle Mainnet.\nTX: ${txHash}\nExplorer: ${NETWORKS.mantle.explorer}/tx/${txHash}`,
            txHash,
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
      description: "Log an agent action for EU AI Act compliance (Art. 12, 19, 50). Batch-anchored on-chain as a Merkle root; pass flush: true to anchor immediately.",
      similes: ["log action", "audit log", "compliance log", "record action", "log to blockchain"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const buffer = getBuffer();
          const { network } = getContext();

          const agentId     = options?.agentId    || process.env.AUDIT_AGENT_ID;
          const actionType  = options?.actionType || "MESSAGE";
          const risk        = riskName(options?.riskLevel);
          const payloadHash = hashContent(message.content);

          const { preimage, record } = auditEntry(agentId, actionType, risk, payloadHash);
          const { actionRef } = await buffer.add(preimage, record);
          if (options?.flush) await buffer.flush();

          const proof = buffer.getInclusionProof(actionRef);
          log(`Action ${proof ? "anchored" : "buffered"} | ${actionType} | ${actionRef} | Network: ${network.name}`);

          if (callback) callback({
            text: proof
              ? `✅ Action anchored on ${network.name}.\nAction: ${actionType}\nRisk: ${risk}\naction_ref: ${actionRef}\nTX: ${proof.txHash}`
              : `✅ Action recorded for batch anchoring on ${network.name}.\nAction: ${actionType}\nRisk: ${risk}\naction_ref: ${actionRef}\nPending in batch: ${buffer.size}`,
            actionRef,
            payloadHash,
            network: network.name,
            txHash: proof?.txHash,
            batchId: proof?.batchId,
            pending: buffer.size,
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
        { user: "agent", content: { text: "Action recorded for batch anchoring on base. action_ref: 0xabc..." } },
      ]],
    },

    // ── Action 3: Batch Log (Art. 12, 19) ─────────────────────────────────
    {
      name: "LOG_AUDIT_BATCH",
      description: "Log multiple agent actions and anchor them now in a single commitBatch tx (Art. 12, 19).",
      similes: ["batch log", "log batch", "multi log", "bulk audit"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const agentId = options?.agentId || process.env.AUDIT_AGENT_ID;
          const actions = options?.actions || [];

          if (!actions.length) throw new Error("No actions provided for batch log");

          const buffer = getBuffer();
          const { network } = getContext();

          const actionRefs = [];
          for (const a of actions) {
            const actionType = a.type || "ACTION";
            const { preimage, record } = auditEntry(agentId, actionType, riskName(a.riskLevel), hashContent(a.payload || a));
            actionRefs.push((await buffer.add(preimage, record)).actionRef);
          }
          await buffer.flush();

          const proof = buffer.getInclusionProof(actionRefs[actionRefs.length - 1]);
          log(`Batch anchored | ${actions.length} actions | TX: ${proof.txHash} | Network: ${network.name}`);

          if (callback) callback({
            text: `✅ Batch anchored ${actions.length} actions on ${network.name}.\nTX: ${proof.txHash}`,
            txHash: proof.txHash,
            batchId: proof.batchId,
            count: actions.length,
            actionRefs,
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
        { user: "agent", content: { text: "Batch anchored 5 actions on base. TX: 0xabc..." } },
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
          const { wallet } = getWallet();
          const REGISTRY = process.env.AUDIT_INCIDENT_REGISTRY;
          const contract = new ethers.Contract(REGISTRY, INCIDENT_REGISTRY_ABI, wallet);

          const agentId     = options?.agentId     || ethers.id(process.env.AUDIT_AGENT_ID || "agent");
          const severity    = options?.severity     || 1; // 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
          const description = options?.description  || message.content?.text || "Incident reported";
          const evidenceHash = options?.evidenceHash || ethers.keccak256(ethers.toUtf8Bytes(description));
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
          const { wallet } = getWallet();
          const MONITOR = process.env.AUDIT_MONITOR_ADDRESS;
          const contract = new ethers.Contract(MONITOR, POST_MARKET_MONITOR_ABI, wallet);

          const agent      = options?.agentAddress || wallet.address;
          const metricType = options?.metricType   || 3; // 3 = COMPLIANCE_SCORE (TODO: `||` turns 0 into 3 — see CHANGELOG)
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
      description: "Check AgentAudit AI status: network, batch anchoring availability, batches on-chain, pending entries.",
      similes: ["audit status", "check compliance", "log count", "audit info"],

      validate: async (runtime, message) => {
        return !!process.env.AUDIT_PRIVATE_KEY && !!process.env.AUDIT_AGENT_ID;
      },

      handler: async (runtime, message, state, options, callback) => {
        try {
          const ctx = getContext();
          const { network } = ctx;
          const agentId = options?.agentId || process.env.AUDIT_AGENT_ID;
          const agentAddress = ctx.sdk.getAddress();
          const pending = ctx.buffer ? ctx.buffer.size : 0;

          let available = true;
          let anchoring = "available";
          try {
            ctx.sdk.assertBatchAnchoring();
          } catch (e) {
            available = false;
            anchoring = `unavailable — ${e.message}`;
          }

          let count = null;
          if (available) {
            const provider = new ethers.JsonRpcProvider(network.rpc);
            const vault = new ethers.Contract(network.auditVault, AUDIT_VAULT_V2_READ_ABI, provider);
            count = (await vault.getBatchCount(agentAddress)).toString();
          }

          const status = [
            "AgentAudit AI Status",
            `Network: ${network.name}`,
            `Agent ID: ${agentId}`,
            `Agent address: ${agentAddress}`,
            `Batch anchoring: ${anchoring}`,
            `Batches on-chain: ${count ?? "n/a"}`,
            `Pending in buffer: ${pending}`,
            `Explorer: ${network.explorer}`,
          ].join("\n");

          log(status);
          if (callback) callback({ text: status, count, pending, network: network.name });

          return true;
        } catch (error) {
          console.error("[AgentAudit] Status error:", error.message);
          if (callback) callback({ text: `AgentAudit error: ${error.message}` });
          return false;
        }
      },

      examples: [[
        { user: "user",  content: { text: "What's the audit status?" } },
        { user: "agent", content: { text: "AgentAudit AI Status\nNetwork: base\nBatches on-chain: 12" } },
      ]],
    },
  ],

  // ── Auto-log middleware ────────────────────────────────────────────────────
  // Attach to runtime to auto-log every agent action. Never blocks the agent:
  // the entry is buffered without awaiting, and failures are swallowed.
  middleware: async (runtime, message, state, next) => {
    if (process.env.AUDIT_AUTO_LOG === "true" && process.env.AUDIT_AGENT_ID) {
      try {
        const buffer = getBuffer();
        const { preimage, record } = auditEntry(process.env.AUDIT_AGENT_ID, "AUTO_LOG", "LOW", hashContent(message.content));
        buffer.add(preimage, record).catch(() => {});
        log("Auto-logged (buffered for batch anchoring)");
      } catch (e) {
        // Silent fail — don't block agent
      }
    }
    return next();
  },

  // ── Batch control (not an ElizaOS action) ──────────────────────────────────
  batch: {
    /** Anchor everything buffered now */
    flush: () => getBuffer().flush(),
    /** Flush the remainder and stop the timer — call on shutdown */
    close: async () => (_ctx && _ctx.buffer ? _ctx.buffer.close() : null),
    /** { leaf, proof[], root, batchId, batchIndex, agentAddress, txHash } or null */
    getInclusionProof: (actionRef) => (_ctx && _ctx.buffer ? _ctx.buffer.getInclusionProof(actionRef) : null),
    /** Number of entries waiting for the next flush */
    pending: () => (_ctx && _ctx.buffer ? _ctx.buffer.size : 0),
    /** Test hook: drop the cached SDK client and buffer */
    _reset: () => { _ctx = null; },
  },
};

// ─── .env example (print if no key set) ──────────────────────────────────────

if (!process.env.AUDIT_PRIVATE_KEY) {
  console.warn(`
[AgentAudit AI] Missing env vars. Add to your .env:

AUDIT_PRIVATE_KEY=0x...          # Agent wallet private key
AUDIT_AGENT_ID=1                 # Your registered agent ID
AUDIT_NETWORK=base               # mantle | base | arbitrum | optimism | polygon (batch anchoring: base)
AUDIT_AUTO_LOG=false             # true = auto-log every action
AUDIT_INCIDENT_REGISTRY=0x...   # IncidentRegistry contract address (Art. 73)
AUDIT_MONITOR_ADDRESS=0x...     # PostMarketMonitor contract address (Art. 72)
AUDIT_BATCH_DIR=./agentaudit-batches  # optional: where batch JSON files are written (hashes only)
AUDIT_RPC_URL=                   # optional: override the network RPC URL
AUDIT_VAULT_ADDRESS=             # optional: AuditVault v2 address (enables batching on any network)
`);
}

module.exports = agentAuditPlugin;
