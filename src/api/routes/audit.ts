import { Router, Request, Response } from "express";
import { validateBody } from "../middleware/validate";
import { isAddress } from "ethers";
import { getChainClient, getBaseVaultReader, NetworkNotConfiguredError, ContractConfigError } from "../chain";
import { buildEvidenceReport } from "../report";
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
    if (err instanceof NetworkNotConfiguredError || err instanceof ContractConfigError) {
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
    if (err instanceof NetworkNotConfiguredError || err instanceof ContractConfigError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[GET /v1/audit/:agentId]", err);
    res.status(502).json({ error: "Failed to fetch audit trail", detail: err.message });
  }
});

// GET /v1/audit/:agentId/report — evidence report (v2): lists the on-chain evidence that
// was checked per Article. It does not determine compliance.
router.get("/audit/:agentId/report", async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const network = (req.query.network as Network) || "mantle";
  const agentAddress = req.query.agent_address === undefined ? undefined : String(req.query.agent_address);

  if (!/^\d+$/.test(agentId)) {
    res.status(400).json({ error: "agentId must be a numeric string" });
    return;
  }
  if (agentAddress !== undefined && !isAddress(agentAddress)) {
    res.status(400).json({ error: "agent_address must be a valid EVM address" });
    return;
  }

  try {
    const client = getChainClient(network);
    const vaultReader = getBaseVaultReader();
    const [agent, logs, vault] = await Promise.all([
      client.getAgentInfo(Number(agentId)),
      client.auditBatchAddress ? client.getAuditTrail(Number(agentId)) : Promise.resolve(null),
      agentAddress ? vaultReader.getBatchSummary(agentAddress) : Promise.resolve(null),
    ]);

    res.json(buildEvidenceReport({
      agentId,
      network,
      registrationAddress: client.registrationAddress,
      agent,
      auditBatch: logs && client.auditBatchAddress ? { address: client.auditBatchAddress, logs } : null,
      vault,
      vaultAddress: vaultReader.vaultAddress,
    }));
  } catch (err: any) {
    if (err instanceof NetworkNotConfiguredError || err instanceof ContractConfigError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[GET /v1/audit/:agentId/report]", err);
    res.status(502).json({ error: "Failed to generate report", detail: err.message });
  }
});

export default router;
