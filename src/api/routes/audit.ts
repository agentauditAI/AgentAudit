import { Router, Request, Response } from "express";
import { validateBody } from "../middleware/validate";
import { getChainClient, NetworkNotConfiguredError } from "../chain";
import { AuditRequestSchema, ARTICLES_BY_RISK, Network } from "../types";
import { randomUUID } from "crypto";

const router = Router();

// POST /v1/audit — log an agent decision on-chain
router.post("/audit", validateBody(AuditRequestSchema), async (req: Request, res: Response) => {
  const { agent_id, action, decision, risk_level, network, metadata } = req.body;

  try {
    const client = getChainClient(network as Network);
    const payload = JSON.stringify({ agent_id, action, decision, risk_level, metadata });
    const txHash = await client.logAction(Number(agent_id), action, payload);

    res.status(201).json({
      status: "logged",
      audit_id: randomUUID(),
      tx_hash: txHash,
      articles: ARTICLES_BY_RISK[risk_level],
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err instanceof NetworkNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[POST /v1/audit]", err);
    res.status(502).json({ error: "Chain transaction failed", detail: err.message });
  }
});

// GET /v1/audit/:agentId — get the full audit trail for an agent
router.get("/audit/:agentId", async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const network = (req.query.network as Network) || "mantle";

  if (!/^\d+$/.test(agentId)) {
    res.status(400).json({ error: "agentId must be a numeric string" });
    return;
  }

  try {
    const client = getChainClient(network);
    const logs = await client.getAuditTrail(Number(agentId));

    res.json({
      agent_id: agentId,
      network,
      total: logs.length,
      logs,
    });
  } catch (err: any) {
    if (err instanceof NetworkNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[GET /v1/audit/:agentId]", err);
    res.status(502).json({ error: "Failed to fetch audit trail", detail: err.message });
  }
});

// GET /v1/audit/:agentId/report — generate EU AI Act compliance report
router.get("/audit/:agentId/report", async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const network = (req.query.network as Network) || "mantle";

  if (!/^\d+$/.test(agentId)) {
    res.status(400).json({ error: "agentId must be a numeric string" });
    return;
  }

  try {
    const client = getChainClient(network);
    const [agentInfo, logs] = await Promise.all([
      client.getAgentInfo(Number(agentId)),
      client.getAuditTrail(Number(agentId)),
    ]);

    const riskLevel = agentInfo.complianceLevel === "high"
      ? "HIGH"
      : agentInfo.complianceLevel === "limited"
      ? "MEDIUM"
      : "LOW";

    const report = {
      generated_at: new Date().toISOString(),
      agent_id: agentId,
      network,
      agent: {
        name: agentInfo.name,
        operator: agentInfo.operator,
        registered_at: new Date(agentInfo.createdAt * 1000).toISOString(),
        compliance_level: agentInfo.complianceLevel,
        active: agentInfo.active,
      },
      audit_summary: {
        total_actions_logged: agentInfo.logCount,
        actions_in_trail: logs.length,
        first_action: logs.length > 0
          ? new Date(logs[0].timestamp * 1000).toISOString()
          : null,
        last_action: logs.length > 0
          ? new Date(logs[logs.length - 1].timestamp * 1000).toISOString()
          : null,
      },
      eu_ai_act_compliance: {
        applicable_articles: ARTICLES_BY_RISK[riskLevel as keyof typeof ARTICLES_BY_RISK],
        compliance_status: agentInfo.active ? "COMPLIANT" : "NON_COMPLIANT",
        obligations: buildObligations(riskLevel as "HIGH" | "MEDIUM" | "LOW"),
      },
    };

    res.json(report);
  } catch (err: any) {
    if (err instanceof NetworkNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[GET /v1/audit/:agentId/report]", err);
    res.status(502).json({ error: "Failed to generate report", detail: err.message });
  }
});

function buildObligations(riskLevel: "HIGH" | "MEDIUM" | "LOW") {
  const base = [
    { article: "Art. 12", obligation: "Record-keeping — immutable audit log maintained on-chain", met: true },
    { article: "Art. 19", obligation: "Logging requirements — per-action logging active", met: true },
  ];
  if (riskLevel === "LOW") return base;

  const medium = [
    ...base,
    { article: "Art. 13", obligation: "Transparency — public log queryability enabled", met: true },
  ];
  if (riskLevel === "MEDIUM") return medium;

  return [
    ...medium,
    { article: "Art. 9",  obligation: "Risk management — on-chain audit trail as risk evidence", met: true },
    { article: "Art. 26", obligation: "Deployer obligations — KYA registration recorded", met: true },
    { article: "Art. 72", obligation: "Post-market monitoring — continuous activity log active", met: true },
  ];
}

export default router;
