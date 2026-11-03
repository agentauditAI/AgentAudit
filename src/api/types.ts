import { z } from "zod";

export const NETWORKS = ["mantle", "base", "arbitrum", "optimism", "polygon"] as const;
export const RISK_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

export type Network = (typeof NETWORKS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const AuditRequestSchema = z.object({
  agent_id: z
    .string()
    .min(1)
    .regex(/^\d+$/, "agent_id must be a numeric string (on-chain uint256 id)"),
  action: z.string().min(1),
  decision: z.string().min(1),
  risk_level: z.enum(RISK_LEVELS),
  network: z.enum(NETWORKS),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type AuditRequest = z.infer<typeof AuditRequestSchema>;

// EU AI Act articles mapped from the operator's self-declared risk tier;
// not a legal classification or compliance result
export const ARTICLES_BY_RISK: Record<RiskLevel, string[]> = {
  HIGH:   ["Art. 9", "Art. 12", "Art. 13", "Art. 19", "Art. 26", "Art. 72"],
  MEDIUM: ["Art. 12", "Art. 13", "Art. 19"],
  LOW:    ["Art. 12", "Art. 19"],
};
