import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ─── Deployment Addresses ────────────────────────────────────────────────────

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

type NetworkKey = "mantle" | "base" | "arbitrum" | "optimism" | "polygon";

const DEPLOYMENT_FILES: Record<NetworkKey, string> = {
  mantle:   "phase7-mantle.json",
  base:     "phase7-base.json",
  arbitrum: "phase7-arbitrumOne.json",
  optimism: "phase7-optimism.json",
  polygon:  "phase7-polygon.json",
};

function loadDeployment(network: NetworkKey): Record<string, string> {
  const filePath = path.join(DEPLOYMENTS_DIR, DEPLOYMENT_FILES[network]);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return raw.contracts as Record<string, string>;
}

const ADDRESSES: Record<NetworkKey, Record<string, string>> = {
  mantle:   loadDeployment("mantle"),
  base:     loadDeployment("base"),
  arbitrum: loadDeployment("arbitrum"),
  optimism: loadDeployment("optimism"),
  polygon:  loadDeployment("polygon"),
};

// ─── RPC & Wallet ────────────────────────────────────────────────────────────

const RPC_URLS: Record<NetworkKey, string> = {
  mantle:   process.env.RPC_MANTLE   || "https://rpc.mantle.xyz",
  base:     process.env.RPC_BASE     || "https://mainnet.base.org",
  arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
  polygon:  process.env.RPC_POLYGON  || "https://polygon-rpc.com",
};

function getSigner(network: NetworkKey): ethers.Wallet {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var not set");
  const provider = new ethers.JsonRpcProvider(RPC_URLS[network]);
  return new ethers.Wallet(privateKey, provider);
}

function getReadonlyProvider(network: NetworkKey): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RPC_URLS[network]);
}

// ─── ABIs ────────────────────────────────────────────────────────────────────

const AUDIT_BATCH_ABI = [
  "function logAction(uint256 agentId, string actionType, bytes32 payloadHash) external",
  "function getLogCount(uint256 agentId) external view returns (uint256)",
];

const RISK_ABI = [
  "function openRiskCount(bytes32 agentId) external view returns (uint256)",
  "function risksAboveSeverity(bytes32 agentId, uint8 minSeverity) external view returns (uint256)",
  "function getAgentRisks(bytes32 agentId) external view returns (uint256[])",
  "function risks(uint256 id) external view returns (uint256 id, bytes32 agentId, uint8 category, uint8 severity, uint8 status, string description, string evidenceUri, uint16 likelihood, uint16 impact, address identifiedBy, uint256 identifiedAt, uint256 updatedAt)",
];

const CONFORMITY_ABI = [
  "function isValid(bytes32 agentId) external view returns (bool)",
  "function getRecord(bytes32 agentId) external view returns (tuple(bytes32 agentId, uint8 assessmentType, uint8 status, string providerName, string providerAddress, string systemDescription, string notifiedBodyName, string notifiedBodyRef, string certificateRef, string standardsApplied, string declarationUri, uint256 validFrom, uint256 validUntil, address registeredBy, uint256 registeredAt, uint256 updatedAt, string withdrawalReason))",
  "function getRegisteredCount() external view returns (uint256)",
];

const INCIDENT_ABI = [
  "function registerIncident(bytes32 agentId, uint8 severity, uint8 harmType, string description, string evidenceHash, uint256 affectedPersons, uint256 occurredAt) external returns (uint256 id)",
  "function getAgentIncidents(bytes32 agentId) external view returns (uint256[])",
  "function incidents(uint256 id) external view returns (uint256 id, bytes32 agentId, uint8 severity, uint8 harmType, uint8 status, string description, string evidenceHash, uint256 affectedPersons, address reportedBy, uint256 occurredAt, uint256 registeredAt, uint256 reportedToAuthorityAt, address authorityAddress, string authorityRef, bool withinDeadline, string rootCauseUri, string correctionUri)",
];

// Existing AgentAuditBatch addresses — from chain.ts env var pattern
const AUDIT_BATCH_ADDRESSES: Record<NetworkKey, string> = {
  mantle:   process.env.AUDIT_BATCH_MANTLE   || "0xAF9ccA0C3D79900576557329F57824A0e277",
  base:     process.env.AUDIT_BATCH_BASE     || "",
  arbitrum: process.env.AUDIT_BATCH_ARBITRUM || "",
  optimism: process.env.AUDIT_BATCH_OPTIMISM || "",
  polygon:  process.env.AUDIT_BATCH_POLYGON  || "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_LABELS = ["NEGLIGIBLE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RISK_STATUS_LABELS = ["IDENTIFIED", "ASSESSED", "MITIGATED", "TESTED", "RESIDUAL", "CLOSED"];
const CONFORMITY_STATUS_LABELS = ["PENDING", "CERTIFIED", "WITHDRAWN", "EXPIRED"];
const INCIDENT_SEVERITY_LABELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const INCIDENT_STATUS_LABELS = ["OPEN", "REPORTED", "UNDER_INVESTIGATION", "RESOLVED", "CLOSED"];
const HARM_TYPE_LABELS = ["DEATH", "SERIOUS_HEALTH_HARM", "SIGNIFICANT_PROPERTY_DAMAGE", "FUNDAMENTAL_RIGHTS_VIOLATION", "OTHER"];

const NETWORKS = ["mantle", "base", "arbitrum", "optimism", "polygon"] as const;

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "agentaudit", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool 1: audit_action ────────────────────────────────────────────────────

server.tool(
  "audit_action",
  "Log an AI agent action to the AgentAuditBatch contract. Broadcasts to all 5 networks when network is omitted.",
  {
    agent_id:    z.number().int().positive().describe("On-chain agent ID (uint256)"),
    action_type: z.string().min(1).describe("Action type label, e.g. LLM_DECISION"),
    payload:     z.string().min(1).describe("Raw payload — will be keccak256-hashed before logging"),
    network:     z.enum(["mantle", "base", "arbitrum", "optimism", "polygon"]).optional()
                  .describe("Target network. Omit to broadcast to all 5 networks."),
  },
  async ({ agent_id, action_type, payload, network }) => {
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
    const targets: NetworkKey[] = network ? [network] : [...NETWORKS];

    const results: string[] = [];

    for (const net of targets) {
      const addr = AUDIT_BATCH_ADDRESSES[net];
      if (!addr) {
        results.push(`${net}: skipped — AUDIT_BATCH_${net.toUpperCase()} not configured`);
        continue;
      }
      try {
        const signer = getSigner(net);
        const contract = new ethers.Contract(addr, AUDIT_BATCH_ABI, signer);
        const tx = await contract.logAction(agent_id, action_type, payloadHash);
        await tx.wait();
        results.push(`${net}: ✓  tx=${tx.hash}`);
      } catch (err: any) {
        results.push(`${net}: ✗  ${err.message}`);
      }
    }

    return {
      content: [{
        type: "text",
        text: [
          `audit_action — agentId=${agent_id} actionType=${action_type}`,
          `payloadHash=${payloadHash}`,
          "",
          ...results,
        ].join("\n"),
      }],
    };
  }
);

// ─── Tool 2: get_risk_score ──────────────────────────────────────────────────

server.tool(
  "get_risk_score",
  "Query the RiskManagementSystem contract for an agent's risk profile (EU AI Act Art. 9).",
  {
    agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
    network:  z.enum(["mantle", "base", "arbitrum", "optimism", "polygon"]).default("mantle"),
  },
  async ({ agent_id, network }) => {
    const agentId = ethers.zeroPadValue(agent_id, 32);
    const addr = ADDRESSES[network as NetworkKey].RiskManagementSystem;
    const provider = getReadonlyProvider(network as NetworkKey);
    const contract = new ethers.Contract(addr, RISK_ABI, provider);

    const [riskIds, openCount, highCount, criticalCount] = await Promise.all([
      contract.getAgentRisks(agentId),
      contract.openRiskCount(agentId),
      contract.risksAboveSeverity(agentId, 3),   // HIGH = 3
      contract.risksAboveSeverity(agentId, 4),   // CRITICAL = 4
    ]);

    const totalRisks = (riskIds as bigint[]).length;

    const lines = [
      `get_risk_score — network=${network}  agentId=${agent_id}`,
      `contract=${addr}`,
      "",
      `Total risks  : ${totalRisks}`,
      `Open risks   : ${openCount.toString()}`,
      `HIGH+        : ${highCount.toString()}`,
      `CRITICAL     : ${criticalCount.toString()}`,
    ];

    if (totalRisks > 0 && totalRisks <= 10) {
      lines.push("", "Risk breakdown:");
      for (const id of riskIds as bigint[]) {
        const r = await contract.risks(id);
        lines.push(
          `  [${id}] ${SEVERITY_LABELS[Number(r.severity)].padEnd(10)} ` +
          `${RISK_STATUS_LABELS[Number(r.status)].padEnd(12)} ` +
          `likelihood=${(Number(r.likelihood) / 100).toFixed(0)}%  ` +
          r.description.slice(0, 60)
        );
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool 3: check_conformity ────────────────────────────────────────────────

server.tool(
  "check_conformity",
  "Query the ConformityAssessment contract for an agent's EU Declaration of Conformity status (Art. 43, 44).",
  {
    agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
    network:  z.enum(["mantle", "base", "arbitrum", "optimism", "polygon"]).default("mantle"),
  },
  async ({ agent_id, network }) => {
    const agentId = ethers.zeroPadValue(agent_id, 32);
    const addr = ADDRESSES[network as NetworkKey].ConformityAssessment;
    const provider = getReadonlyProvider(network as NetworkKey);
    const contract = new ethers.Contract(addr, CONFORMITY_ABI, provider);

    const isValid = await contract.isValid(agentId) as boolean;

    let record: any = null;
    try {
      record = await contract.getRecord(agentId);
    } catch {
      // not registered
    }

    const lines = [
      `check_conformity — network=${network}  agentId=${agent_id}`,
      `contract=${addr}`,
      "",
      `Valid (certified + not expired): ${isValid ? "YES ✓" : "NO ✗"}`,
    ];

    if (record) {
      const statusLabel = CONFORMITY_STATUS_LABELS[Number(record.status)] ?? "UNKNOWN";
      const assessmentLabel = Number(record.assessmentType) === 0 ? "SELF_ASSESSMENT" : "NOTIFIED_BODY";
      const validFrom  = new Date(Number(record.validFrom) * 1000).toISOString().slice(0, 10);
      const validUntil = new Date(Number(record.validUntil) * 1000).toISOString().slice(0, 10);
      lines.push(
        `Status       : ${statusLabel}`,
        `Assessment   : ${assessmentLabel}`,
        `Provider     : ${record.providerName}`,
        `Valid from   : ${validFrom}`,
        `Valid until  : ${validUntil}`,
        `Declaration  : ${record.declarationUri || "(none)"}`,
        `Certificate  : ${record.certificateRef || "(none)"}`,
        `Notified body: ${record.notifiedBodyName || "(none)"}`,
      );
      if (record.withdrawalReason) {
        lines.push(`Withdrawal   : ${record.withdrawalReason}`);
      }
    } else {
      lines.push("No conformity record found for this agent.");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool 4: report_incident ─────────────────────────────────────────────────

server.tool(
  "report_incident",
  "Register a serious AI incident with the IncidentRegistry contract (EU AI Act Art. 73).",
  {
    agent_id:          z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
    severity:          z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Incident severity"),
    harm_type:         z.enum(["DEATH", "SERIOUS_HEALTH_HARM", "SIGNIFICANT_PROPERTY_DAMAGE", "FUNDAMENTAL_RIGHTS_VIOLATION", "OTHER"]),
    description:       z.string().min(1).describe("Human-readable incident description"),
    evidence_hash:     z.string().describe("IPFS CID or hash of incident evidence"),
    affected_persons:  z.number().int().nonnegative().describe("Number of persons affected"),
    occurred_at:       z.number().int().positive().describe("Unix timestamp when incident occurred"),
    network:           z.enum(["mantle", "base", "arbitrum", "optimism", "polygon"]).default("mantle"),
  },
  async ({ agent_id, severity, harm_type, description, evidence_hash, affected_persons, occurred_at, network }) => {
    const agentId    = ethers.zeroPadValue(agent_id, 32);
    const severityIdx  = INCIDENT_SEVERITY_LABELS.indexOf(severity);
    const harmTypeIdx  = HARM_TYPE_LABELS.indexOf(harm_type);
    const addr = ADDRESSES[network as NetworkKey].IncidentRegistry;
    const signer = getSigner(network as NetworkKey);
    const contract = new ethers.Contract(addr, INCIDENT_ABI, signer);

    const tx = await contract.registerIncident(
      agentId,
      severityIdx,
      harmTypeIdx,
      description,
      evidence_hash,
      affected_persons,
      occurred_at
    );
    const receipt = await tx.wait();

    // Parse incidentId from return value via static call (tx already confirmed)
    let incidentId = "(check logs)";
    try {
      const iface = new ethers.Interface(INCIDENT_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "IncidentRegistered") {
            incidentId = parsed.args.id.toString();
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    const deadline = severity === "CRITICAL" ? "2 days" : severity === "HIGH" ? "10 days" : "15 days";

    return {
      content: [{
        type: "text",
        text: [
          `report_incident — Art. 73`,
          `network=${network}  contract=${addr}`,
          "",
          `Incident ID      : ${incidentId}`,
          `Tx hash          : ${tx.hash}`,
          `Severity         : ${severity}`,
          `Harm type        : ${harm_type}`,
          `Affected persons : ${affected_persons}`,
          `Art. 73§2 deadline: report to authority within ${deadline} of occurrence`,
        ].join("\n"),
      }],
    };
  }
);

// ─── Tool 5: get_compliance_report ───────────────────────────────────────────

server.tool(
  "get_compliance_report",
  "Generate a full EU AI Act compliance report for an agent by querying all Phase 7 contracts on one or all networks.",
  {
    agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
    network:  z.enum(["mantle", "base", "arbitrum", "optimism", "polygon", "all"]).default("all"),
  },
  async ({ agent_id, network }) => {
    const agentId  = ethers.zeroPadValue(agent_id, 32);
    const targets: NetworkKey[] = network === "all" ? [...NETWORKS] : [network as NetworkKey];

    const lines = [
      "═══════════════════════════════════════════════════════════",
      "  AgentAudit — EU AI Act Compliance Report",
      `  Agent   : ${agent_id}`,
      `  Date    : ${new Date().toISOString()}`,
      "═══════════════════════════════════════════════════════════",
    ];

    for (const net of targets) {
      const addrs = ADDRESSES[net];
      const provider = getReadonlyProvider(net);
      lines.push("", `── Network: ${net.toUpperCase()} ──────────────────────────────────`);

      // Art. 43/44 — Conformity Assessment
      try {
        const conformity = new ethers.Contract(addrs.ConformityAssessment, CONFORMITY_ABI, provider);
        const isValid = await conformity.isValid(agentId) as boolean;
        let statusLabel = "NOT REGISTERED";
        let validUntil = "";
        try {
          const rec = await conformity.getRecord(agentId);
          statusLabel = CONFORMITY_STATUS_LABELS[Number(rec.status)];
          validUntil  = new Date(Number(rec.validUntil) * 1000).toISOString().slice(0, 10);
        } catch { /* not registered */ }
        lines.push(
          `  Art. 43/44 Conformity  : ${statusLabel}${validUntil ? `  (expires ${validUntil})` : ""}`,
          `    → Currently valid    : ${isValid ? "YES ✓" : "NO ✗"}`
        );
      } catch (e: any) {
        lines.push(`  Art. 43/44 Conformity  : error — ${e.message}`);
      }

      // Art. 9 — Risk Management
      try {
        const risk = new ethers.Contract(addrs.RiskManagementSystem, RISK_ABI, provider);
        const [openCount, highCount, criticalCount] = await Promise.all([
          risk.openRiskCount(agentId),
          risk.risksAboveSeverity(agentId, 3),
          risk.risksAboveSeverity(agentId, 4),
        ]);
        lines.push(
          `  Art. 9   Risk Mgmt     : open=${openCount}  HIGH+=${highCount}  CRITICAL=${criticalCount}`
        );
      } catch (e: any) {
        lines.push(`  Art. 9   Risk Mgmt     : error — ${e.message}`);
      }

      // Art. 73 — Incident Registry
      try {
        const incident = new ethers.Contract(addrs.IncidentRegistry, INCIDENT_ABI, provider);
        const ids = await incident.getAgentIncidents(agentId) as bigint[];
        let openIncidents = 0;
        for (const id of ids) {
          const inc = await incident.incidents(id);
          if (Number(inc.status) < 3) openIncidents++; // < RESOLVED
        }
        lines.push(
          `  Art. 73  Incidents     : total=${ids.length}  open=${openIncidents}`
        );
      } catch (e: any) {
        lines.push(`  Art. 73  Incidents     : error — ${e.message}`);
      }
    }

    lines.push(
      "",
      "═══════════════════════════════════════════════════════════",
      "  Contracts queried: ConformityAssessment, RiskManagementSystem,",
      "  IncidentRegistry (Phase 7 deployment)",
      "═══════════════════════════════════════════════════════════",
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
