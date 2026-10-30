import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  AgentAudit,
  BatchBuffer,
  MemoryBatchStore,
  NETWORKS as SDK_NETWORKS,
  canonicalize,
  sha256Hex,
  type ActionPreimage,
  type BatchCommitter,
} from "../sdk/src/index";
import { AUDIT_VAULT_V2_ABI, EthersChainReader } from "../tools/verify/src/verify";
import { actionRef, preimageProblem } from "../tools/verify/src/evidence";

// ─── Deployment Addresses ────────────────────────────────────────────────────

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

type NetworkKey = "mantle" | "base" | "arbitrum" | "optimism" | "polygon";
type Phase7Contract = "RiskManagementSystem" | "ConformityAssessment" | "IncidentRegistry";

const NETWORKS = ["mantle", "base", "arbitrum", "optimism", "polygon"] as const;

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

const DEFAULT_RPC_URLS: Record<NetworkKey, string> = {
  mantle:   "https://rpc.mantle.xyz",
  base:     "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  polygon:  "https://polygon-bor-rpc.publicnode.com",
};

// ─── Configuration ───────────────────────────────────────────────────────────

export interface McpServerOptions {
  /** Signer key for audit_action and report_incident (env PRIVATE_KEY) */
  privateKey?: string;
  /** Per-network RPC overrides (env RPC_<NETWORK>) */
  rpcUrls?: Partial<Record<NetworkKey, string>>;
  /** AuditVault v2 overrides (env AUDIT_VAULT_<NETWORK>); the SDK default is used only where it is v2 */
  auditVaults?: Partial<Record<NetworkKey, string>>;
  /** Phase 7 address overrides; defaults come from deployments/phase7-<network>.json */
  phase7?: Partial<Record<NetworkKey, Partial<Record<Phase7Contract, string>>>>;
}

/** Options read from the environment — what the stdio entry point uses */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): McpServerOptions {
  const rpcUrls: Partial<Record<NetworkKey, string>> = {};
  const auditVaults: Partial<Record<NetworkKey, string>> = {};
  for (const net of NETWORKS) {
    const rpc = env[`RPC_${net.toUpperCase()}`];
    if (rpc) rpcUrls[net] = rpc;
    const vault = env[`AUDIT_VAULT_${net.toUpperCase()}`];
    if (vault) auditVaults[net] = vault;
  }
  return { privateKey: env.PRIVATE_KEY, rpcUrls, auditVaults };
}

// ─── ABIs ────────────────────────────────────────────────────────────────────

const VAULT_ABI = [...AUDIT_VAULT_V2_ABI, "function getBatchCount(address agentId) view returns (uint256)"];

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
  "event IncidentRegistered(uint256 indexed id, bytes32 indexed agentId, uint8 severity, uint8 harmType, uint256 occurredAt, uint256 timestamp)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_LABELS = ["NEGLIGIBLE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RISK_STATUS_LABELS = ["IDENTIFIED", "ASSESSED", "MITIGATED", "TESTED", "RESIDUAL", "CLOSED"];
const CONFORMITY_STATUS_LABELS = ["PENDING", "CERTIFIED", "WITHDRAWN", "EXPIRED"];
const INCIDENT_SEVERITY_LABELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const HARM_TYPE_LABELS = ["DEATH", "SERIOUS_HEALTH_HARM", "SIGNIFICANT_PROPERTY_DAMAGE", "FUNDAMENTAL_RIGHTS_VIOLATION", "OTHER"];

/** Integration tag stored in each audit_action record (EVIDENCE_SCHEMA §2.5) */
const MCP_PLUGIN = "agentaudit-mcp/2.0";

const BASE_VAULT = SDK_NETWORKS.base.auditVault;

const networkEnum = z.enum(NETWORKS);
const bytes32Hex = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressHex = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) return String((err as { shortMessage: unknown }).shortMessage);
  return err instanceof Error ? err.message : String(err);
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

export function createServer(options: McpServerOptions = optionsFromEnv()): McpServer {
  const rpcUrl = (net: NetworkKey) => options.rpcUrls?.[net] ?? DEFAULT_RPC_URLS[net];

  const providers = new Map<NetworkKey, ethers.JsonRpcProvider>();
  // cacheTimeout -1: back-to-back writes must not reuse a cached nonce
  const provider = (net: NetworkKey) => {
    if (!providers.has(net)) {
      providers.set(net, new ethers.JsonRpcProvider(rpcUrl(net), undefined, { staticNetwork: true, cacheTimeout: -1 }));
    }
    return providers.get(net)!;
  };

  function privateKey(): string {
    if (!options.privateKey) throw new Error("PRIVATE_KEY env var not set");
    return options.privateKey;
  }

  const phase7Defaults = new Map<NetworkKey, Record<string, string>>();
  function phase7Address(net: NetworkKey, name: Phase7Contract): string {
    const override = options.phase7?.[net]?.[name];
    if (override) return override;
    if (!phase7Defaults.has(net)) phase7Defaults.set(net, loadDeployment(net));
    return phase7Defaults.get(net)![name];
  }

  /** Throws a clear error instead of letting a call to an empty address decode as BAD_DATA */
  async function requireCode(net: NetworkKey, address: string, name: string): Promise<void> {
    const code = await provider(net).getCode(address);
    if (code === "0x") throw new Error(`${name} has no contract code on ${net} at ${address}`);
  }

  /** AuditVault v2 for a network, or a clear error — never a silent skip */
  function auditVault(net: NetworkKey): string {
    const override = options.auditVaults?.[net];
    if (override) return ethers.getAddress(override);
    const sdkNet = SDK_NETWORKS[net];
    if (sdkNet.vaultVersion === 2) return sdkNet.auditVault;
    const what = sdkNet.vaultVersion === 1 ? "is AuditVault v1" : "is not AuditVault v2";
    throw new Error(
      `Audit logging is live on Base only: ${net} has no AuditVault v2 (default ${sdkNet.auditVault} ${what}, no commitBatch). ` +
      `Use network "base" or set AUDIT_VAULT_${net.toUpperCase()} to an AuditVault v2 deployment.`
    );
  }

  const server = new McpServer(
    { name: "agentaudit", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  // ─── Tool 1: audit_action ────────────────────────────────────────────────────

  server.tool(
    "audit_action",
    `Anchor one or more agent actions on AuditVault v2 in one commitBatch transaction (EU AI Act Art. 12, 19). ` +
    `Live on Base only (AuditVault v2 ${BASE_VAULT}); any other network returns an error unless AUDIT_VAULT_<NETWORK> points at an AuditVault v2. ` +
    `Each call commits its entries immediately — nothing is buffered between calls. Payloads are SHA-256 hashed; raw content never leaves this process. ` +
    `Returns txHash, batchIndex, merkle_root and each entry's action_ref + proof, plus the evidence bundle: keep it, the batch payload is not stored anywhere else (contentURI is memory://).`,
    {
      agent_id:         z.union([z.string().min(1), z.number().int().nonnegative()]).describe("Agent identifier recorded in each preimage (preimage.agent_id)"),
      entries:          z.array(z.object({
        action_type:    z.string().min(1).describe("Action type label, e.g. LLM_DECISION"),
        payload:        z.union([z.string().min(1), z.record(z.string(), z.unknown())]).describe("Raw payload — only its SHA-256 (JCS for objects) is recorded"),
        risk_level:     z.enum(["LOW", "MEDIUM", "HIGH"]).default("HIGH"),
        timestamp_ms:   z.number().int().nonnegative().optional().describe("Unix ms; defaults to now"),
      })).min(1).max(256).describe("Actions to commit as one batch, in leaf order"),
      agent_address:    addressHex.optional().describe("AuditVault agentId the batch is committed under; defaults to the signer address"),
      compliance_score: z.number().int().min(0).max(100).default(0),
      network:          networkEnum.default("base").describe("Default base — the only network with AuditVault v2"),
    },
    async ({ agent_id, entries, agent_address, compliance_score, network }) => {
      const vault = auditVault(network);
      await requireCode(network, vault, "AuditVault v2");

      const sdk = new AgentAudit({ privateKey: privateKey(), network, rpcUrl: rpcUrl(network), auditVaultAddress: vault });
      const agentAddress = agent_address ? ethers.getAddress(agent_address) : sdk.getAddress();

      // One buffer per call, flushed once. The committer is one-shot so the
      // buffer's retry timer can never resend a batch after this call returned.
      let committed = false;
      const committer: BatchCommitter = {
        commitBatch: (params) => {
          if (committed) return Promise.reject(new Error("audit_action batch already attempted"));
          committed = true;
          return sdk.commitBatch(params);
        },
      };
      const store = new MemoryBatchStore();
      const buffer = new BatchBuffer({
        committer,
        agentAddress,
        store,
        maxEntries: Number.MAX_SAFE_INTEGER, // never auto-flush; flush() below commits everything
        complianceScore: compliance_score,
        onError: () => undefined,
      });

      const now = Date.now();
      const refs: string[] = [];
      for (const e of entries) {
        const payloadDigest = sha256Hex(typeof e.payload === "string" ? e.payload : canonicalize(e.payload));
        const record = { plugin: MCP_PLUGIN, action_type: e.action_type, risk_level: e.risk_level, payload_hash: `sha256:${payloadDigest}` };
        const preimage: ActionPreimage = {
          action_type: e.action_type,
          agent_id: String(agent_id),
          scope: `agent_action:mcp:record_hash:${sha256Hex(canonicalize(record))}`,
          timestamp_ms: e.timestamp_ms ?? now,
        };
        refs.push((await buffer.add(preimage, record)).actionRef);
      }

      const result = (await buffer.flush())!;
      if (result.batchIndex === null) {
        throw new Error(`commitBatch tx ${result.txHash} mined on ${network} but emitted no LogBatchCommitted for root ${result.merkleRoot}`);
      }
      const bundle = (await store.get(result.batchId))!;

      return json({
        network,
        vault,
        txHash: result.txHash,
        batchIndex: result.batchIndex,
        merkle_root: result.merkleRoot,
        agent_address: agentAddress,
        contentURI: result.contentURI,
        entries: bundle.entries.map((entry, i) => ({
          action_ref: entry.action_ref,
          proof: buffer.getInclusionProof(refs[i])!.proof,
          preimage: entry.preimage,
          record: entry.record,
        })),
        evidence: { ...bundle, meta: { anchor: { chain: network, txHash: result.txHash, rootCommitment: result.merkleRoot } } },
      });
    }
  );

  // ─── Tool 2: get_audit_log ───────────────────────────────────────────────────

  server.tool(
    "get_audit_log",
    `Read committed AuditVault v2 batches, by commitBatch tx hash or by agent_address + batch_index (Art. 12, 19). ` +
    `Live on Base only (AuditVault v2 ${BASE_VAULT}); other networks return an error unless AUDIT_VAULT_<NETWORK> is set.`,
    {
      tx_hash:       bytes32Hex.optional().describe("commitBatch transaction hash"),
      agent_address: addressHex.optional().describe("AuditVault agentId (with batch_index)"),
      batch_index:   z.number().int().nonnegative().optional(),
      network:       networkEnum.default("base"),
    },
    async ({ tx_hash, agent_address, batch_index, network }) => {
      const byIndex = agent_address !== undefined && batch_index !== undefined;
      if (!!tx_hash === byIndex) throw new Error("Pass either tx_hash, or agent_address + batch_index");

      const vault = auditVault(network);
      await requireCode(network, vault, "AuditVault v2");
      const contract = new ethers.Contract(vault, VAULT_ABI, provider(network));

      async function readBatch(agent: string, index: bigint) {
        const b = await contract.getBatch(agent, index);
        return {
          agent_address: agent,
          batch_index: Number(index),
          merkle_root: b.merkleRoot,
          contentURI: b.contentURI,
          event_count: Number(b.eventCount),
          compliance_score: Number(b.complianceScore),
          submitter: b.submitter,
          timestamp: Number(b.timestamp),
          block_number: Number(b.blockNumber),
        };
      }

      if (byIndex) {
        const agent = ethers.getAddress(agent_address!);
        const count = await contract.getBatchCount(agent) as bigint;
        if (BigInt(batch_index!) >= count) {
          throw new Error(`Batch ${batch_index} not found for ${agent} on ${network} (agent has ${count} batch${count === 1n ? "" : "es"})`);
        }
        return json({ network, vault, batches: [await readBatch(agent, BigInt(batch_index!))] });
      }

      const receipt = await provider(network).getTransactionReceipt(tx_hash!);
      if (!receipt) throw new Error(`Transaction ${tx_hash} not found on ${network}`);
      if (receipt.status !== 1) throw new Error(`Transaction ${tx_hash} reverted on ${network} (block ${receipt.blockNumber})`);
      const events = receipt.logs
        .filter((l) => ethers.getAddress(l.address) === vault)
        .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
        .filter((p) => p?.name === "LogBatchCommitted");
      if (events.length === 0) throw new Error(`Transaction ${tx_hash} emitted no LogBatchCommitted from ${vault} on ${network}`);

      const batches = [];
      for (const ev of events) batches.push({ ...(await readBatch(ethers.getAddress(ev!.args.agentId), ev!.args.batchIndex)), tx_hash });
      return json({ network, vault, batches });
    }
  );

  // ─── Tool 3: verify_proof ────────────────────────────────────────────────────

  server.tool(
    "verify_proof",
    `Check an audit entry's inclusion proof on-chain with AuditVault v2 verifyLog. The leaf is always recomputed from the preimage (never trusted from the caller); ` +
    `the batch submitter is reported and can be pinned (docs/THREAT_MODEL.md KI-1, KI-2). ` +
    `Live on Base only (AuditVault v2 ${BASE_VAULT}); other networks return an error unless AUDIT_VAULT_<NETWORK> is set.`,
    {
      agent_address:      addressHex.describe("AuditVault agentId the batch was committed under"),
      batch_index:        z.number().int().nonnegative(),
      entry:              z.object({
        preimage:         z.record(z.string(), z.unknown()).describe("{ action_type, agent_id, scope, timestamp_ms }"),
        action_ref:       bytes32Hex.optional().describe("Presented leaf; must match sha256(jcs(preimage)) if given"),
      }),
      proof:              z.array(bytes32Hex).describe("Merkle proof (sibling hashes)"),
      expected_submitter: addressHex.optional().describe("If set, the batch submitter must equal it"),
      network:            networkEnum.default("base"),
    },
    async ({ agent_address, batch_index, entry, proof, expected_submitter, network }) => {
      const problem = preimageProblem(entry.preimage);
      if (problem) throw new Error(`Invalid preimage: ${problem}`);
      const leaf = actionRef(entry.preimage);

      const vault = auditVault(network);
      const reader = new EthersChainReader(rpcUrl(network));
      try {
        if (await reader.getCode(vault) === "0x") throw new Error(`AuditVault v2 has no contract code on ${network} at ${vault}`);
        const agent = ethers.getAddress(agent_address);
        const count = await new ethers.Contract(vault, VAULT_ABI, provider(network)).getBatchCount(agent) as bigint;
        if (BigInt(batch_index) >= count) {
          throw new Error(`Batch ${batch_index} not found for ${agent} on ${network} (agent has ${count} batch${count === 1n ? "" : "es"})`);
        }

        const checks: Record<string, boolean> = {};
        const reasons: string[] = [];
        if (entry.action_ref !== undefined) {
          checks.action_ref_matches = entry.action_ref.toLowerCase() === leaf;
          if (!checks.action_ref_matches) reasons.push(`action_ref ${entry.action_ref} ≠ sha256(jcs(preimage)) ${leaf}`);
        }
        checks.verify_log = await reader.verifyLog(vault, agent, BigInt(batch_index), leaf, proof);
        if (!checks.verify_log) reasons.push("AuditVault.verifyLog returned false");
        const submitter = ethers.getAddress(await reader.getBatchSubmitter(vault, agent, BigInt(batch_index)));
        if (expected_submitter !== undefined) {
          checks.submitter_matches = ethers.getAddress(expected_submitter) === submitter;
          if (!checks.submitter_matches) reasons.push(`batch submitter ${submitter} ≠ expected ${ethers.getAddress(expected_submitter)}`);
        }

        return json({
          valid: Object.values(checks).every(Boolean),
          network,
          vault,
          agent_address: agent,
          batch_index,
          leaf,
          submitter,
          checks,
          ...(reasons.length ? { reasons } : {}),
        });
      } finally {
        reader.destroy();
      }
    }
  );

  // ─── Tool 4: get_risk_score ──────────────────────────────────────────────────

  server.tool(
    "get_risk_score",
    "Query the RiskManagementSystem contract for an agent's risk profile (EU AI Act Art. 9). Deployed on mantle, base, arbitrum, optimism, polygon.",
    {
      agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
      network:  networkEnum.default("mantle"),
    },
    async ({ agent_id, network }) => {
      const agentId = ethers.zeroPadValue(agent_id, 32);
      const addr = phase7Address(network, "RiskManagementSystem");
      await requireCode(network, addr, "RiskManagementSystem");
      const contract = new ethers.Contract(addr, RISK_ABI, provider(network));

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

  // ─── Tool 5: check_conformity ────────────────────────────────────────────────

  server.tool(
    "check_conformity",
    "Query the ConformityAssessment contract for an agent's EU Declaration of Conformity status (Art. 43, 44). Deployed on mantle, base, arbitrum, optimism, polygon.",
    {
      agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
      network:  networkEnum.default("mantle"),
    },
    async ({ agent_id, network }) => {
      const agentId = ethers.zeroPadValue(agent_id, 32);
      const addr = phase7Address(network, "ConformityAssessment");
      await requireCode(network, addr, "ConformityAssessment");
      const contract = new ethers.Contract(addr, CONFORMITY_ABI, provider(network));

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

  // ─── Tool 6: report_incident ─────────────────────────────────────────────────

  server.tool(
    "report_incident",
    "Register a serious AI incident with IncidentRegistry v2 (EU AI Act Art. 73). Live on mantle, base, arbitrum, optimism, polygon. " +
    "Fails unless the registry has code and the transaction emits IncidentRegistered.",
    {
      agent_id:          z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
      severity:          z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Incident severity"),
      harm_type:         z.enum(["DEATH", "SERIOUS_HEALTH_HARM", "SIGNIFICANT_PROPERTY_DAMAGE", "FUNDAMENTAL_RIGHTS_VIOLATION", "OTHER"]),
      description:       z.string().min(1).describe("Human-readable incident description"),
      evidence_hash:     z.string().describe("IPFS CID or hash of incident evidence"),
      affected_persons:  z.number().int().nonnegative().describe("Number of persons affected"),
      occurred_at:       z.number().int().positive().describe("Unix timestamp when incident occurred"),
      network:           networkEnum.default("mantle"),
    },
    async ({ agent_id, severity, harm_type, description, evidence_hash, affected_persons, occurred_at, network }) => {
      const agentId    = ethers.zeroPadValue(agent_id, 32);
      const severityIdx  = INCIDENT_SEVERITY_LABELS.indexOf(severity);
      const harmTypeIdx  = HARM_TYPE_LABELS.indexOf(harm_type);
      const addr = ethers.getAddress(phase7Address(network, "IncidentRegistry"));
      await requireCode(network, addr, "IncidentRegistry");
      const signer = new ethers.Wallet(privateKey(), provider(network));
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

      // Only an IncidentRegistered from the registry itself counts as registration
      let incidentId: string | null = null;
      for (const log of receipt?.logs ?? []) {
        if (ethers.getAddress(log.address) !== addr) continue;
        const parsed = (() => { try { return contract.interface.parseLog(log); } catch { return null; } })();
        if (parsed?.name === "IncidentRegistered") {
          incidentId = parsed.args.id.toString();
          break;
        }
      }
      if (incidentId === null) {
        throw new Error(`Incident NOT registered: tx ${tx.hash} on ${network} emitted no IncidentRegistered from ${addr}`);
      }

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

  // ─── Tool 7: get_compliance_report ───────────────────────────────────────────

  server.tool(
    "get_compliance_report",
    "Generate an EU AI Act compliance report for an agent from the Phase 7 contracts (ConformityAssessment, RiskManagementSystem, IncidentRegistry) " +
    "on one or all of mantle, base, arbitrum, optimism, polygon. Read-only.",
    {
      agent_id: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).describe("Agent ID as a hex bytes32 string"),
      network:  z.enum([...NETWORKS, "all"]).default("all"),
    },
    async ({ agent_id, network }) => {
      const agentId  = ethers.zeroPadValue(agent_id, 32);
      const targets: NetworkKey[] = network === "all" ? [...NETWORKS] : [network];

      const lines = [
        "═══════════════════════════════════════════════════════════",
        "  AgentAudit — EU AI Act Compliance Report",
        `  Agent   : ${agent_id}`,
        `  Date    : ${new Date().toISOString()}`,
        "═══════════════════════════════════════════════════════════",
      ];

      for (const net of targets) {
        const p = provider(net);
        lines.push("", `── Network: ${net.toUpperCase()} ──────────────────────────────────`);

        // Art. 43/44 — Conformity Assessment
        try {
          const addr = phase7Address(net, "ConformityAssessment");
          await requireCode(net, addr, "ConformityAssessment");
          const conformity = new ethers.Contract(addr, CONFORMITY_ABI, p);
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
        } catch (e) {
          lines.push(`  Art. 43/44 Conformity  : error — ${errorMessage(e)}`);
        }

        // Art. 9 — Risk Management
        try {
          const addr = phase7Address(net, "RiskManagementSystem");
          await requireCode(net, addr, "RiskManagementSystem");
          const risk = new ethers.Contract(addr, RISK_ABI, p);
          const [openCount, highCount, criticalCount] = await Promise.all([
            risk.openRiskCount(agentId),
            risk.risksAboveSeverity(agentId, 3),
            risk.risksAboveSeverity(agentId, 4),
          ]);
          lines.push(
            `  Art. 9   Risk Mgmt     : open=${openCount}  HIGH+=${highCount}  CRITICAL=${criticalCount}`
          );
        } catch (e) {
          lines.push(`  Art. 9   Risk Mgmt     : error — ${errorMessage(e)}`);
        }

        // Art. 73 — Incident Registry
        try {
          const addr = phase7Address(net, "IncidentRegistry");
          await requireCode(net, addr, "IncidentRegistry");
          const incident = new ethers.Contract(addr, INCIDENT_ABI, p);
          const ids = await incident.getAgentIncidents(agentId) as bigint[];
          let openIncidents = 0;
          for (const id of ids) {
            const inc = await incident.incidents(id);
            if (Number(inc.status) < 3) openIncidents++; // < RESOLVED
          }
          lines.push(
            `  Art. 73  Incidents     : total=${ids.length}  open=${openIncidents}`
          );
        } catch (e) {
          lines.push(`  Art. 73  Incidents     : error — ${errorMessage(e)}`);
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

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  const transport = new StdioServerTransport();
  createServer().connect(transport).catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
