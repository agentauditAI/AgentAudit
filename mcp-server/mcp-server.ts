#!/usr/bin/env node
/**
 * AgentAudit MCP Server
 * Exposes AuditVault v2 as MCP tools so any AI agent can log audit events on-chain.
 *
 * Required env vars:
 *   PRIVATE_KEY          — signer private key (0x...)
 *   AUDIT_VAULT_ADDRESS  — deployed AuditVault v2 contract address
 *   RPC_URL              — optional, defaults to Mantle mainnet
 *
 * Usage (stdio transport, works with Claude Desktop / any MCP client):
 *   node dist/mcp-server.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// ─── ABI ─────────────────────────────────────────────────────────────────────

const AUDIT_VAULT_ABI = [
  // write
  "function registerAgent(address agentId, string agentType, string framework, string network) external",
  "function commitBatch(address agentId, bytes32 merkleRoot, string contentURI, uint256 eventCount, uint8 complianceScore, string actionType, uint256 spendValue) external",
  // read
  "function getAgentInfo(address agentId) external view returns (tuple(bool registered, string agentType, string framework, string network, uint256 registeredAt, uint256 totalEvents) info)",
  "function getRiskScore(address agentId, uint256 batchIndex) external view returns (tuple(uint8 level, string actionType, uint256 spendValue, uint256 timestamp) rs)",
  "function getBatchCount(address agentId) external view returns (uint256)",
  "function isRegistered(address agentId) external view returns (bool)",
  "function agentEventCount(address) external view returns (uint256)",
];

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL           = process.env.RPC_URL           || "https://rpc.mantle.xyz";
const PRIVATE_KEY       = process.env.PRIVATE_KEY       || "";
const VAULT_ADDRESS     = process.env.AUDIT_VAULT_ADDRESS || "";

if (!PRIVATE_KEY || !VAULT_ADDRESS) {
  process.stderr.write(
    "Missing required env vars: PRIVATE_KEY, AUDIT_VAULT_ADDRESS\n"
  );
  process.exit(1);
}

const provider   = new ethers.JsonRpcProvider(RPC_URL);
const wallet     = new ethers.Wallet(PRIVATE_KEY, provider);
const auditVault = new ethers.Contract(VAULT_ADDRESS, AUDIT_VAULT_ABI, wallet);

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

// ─── Merkle helper ───────────────────────────────────────────────────────────
// Matches the sorting convention used by AuditVault._verifyMerkle on-chain.

function buildMerkleRoot(events: string[]): string {
  if (events.length === 0) throw new Error("events array must not be empty");

  let layer: string[] = events.map((e) =>
    ethers.keccak256(ethers.toUtf8Bytes(e))
  );

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        const a = layer[i];
        const b = layer[i + 1];
        const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
        next.push(ethers.keccak256(ethers.concat([lo, hi])));
      } else {
        next.push(layer[i]); // odd leaf bubbles up unchanged
      }
    }
    layer = next;
  }

  return layer[0];
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "agentaudit-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "register_agent",
      description:
        "Register an AI agent on-chain in AuditVault v2 (KYA standard). " +
        "Must be called once before the agent can commit audit batches.",
      inputSchema: {
        type: "object",
        properties: {
          agentAddress: {
            type: "string",
            description: "Ethereum address of the agent (wallet or contract)",
          },
          agentType: {
            type: "string",
            description: "Agent category e.g. DeFi, DAO, Trading, Assistant",
          },
          framework: {
            type: "string",
            description: "Agent framework e.g. ElizaOS, LangChain, AutoGPT, Claude",
          },
          network: {
            type: "string",
            description: "Network where agent operates e.g. Mantle, Arbitrum, Ethereum",
          },
        },
        required: ["agentAddress", "agentType", "framework", "network"],
      },
    },

    {
      name: "commit_audit_batch",
      description:
        "Commit a batch of agent action logs to AuditVault on-chain. " +
        "Computes Merkle root automatically from the provided events array. " +
        "Returns the assigned risk level (HIGH/MEDIUM/LOW) and transaction hash.",
      inputSchema: {
        type: "object",
        properties: {
          agentAddress: {
            type: "string",
            description: "Ethereum address of the agent",
          },
          events: {
            type: "array",
            items: { type: "string" },
            description:
              "Log event strings for this batch. Merkle root is computed from these.",
          },
          contentURI: {
            type: "string",
            description:
              "IPFS CID or Arweave txId pointing to the full off-chain log payload",
          },
          complianceScore: {
            type: "number",
            minimum: 0,
            maximum: 100,
            description: "EU AI Act compliance score for this batch (0-100)",
          },
          actionType: {
            type: "string",
            description:
              "Dominant action type in this batch. " +
              "HIGH risk: TRANSFER, WITHDRAW, LIQUIDATE, BRIDGE, DRAIN, EMERGENCY_EXIT. " +
              "MEDIUM risk: SWAP, APPROVE, DELEGATE, STAKE, UNSTAKE, BORROW, REPAY. " +
              "LOW risk: anything else (e.g. LOG, READ, QUERY).",
          },
          spendValue: {
            type: "string",
            description:
              "Total spend value in wei for this batch (as string). " +
              "Thresholds: >10 ETH → HIGH, >1 ETH → MEDIUM. Defaults to 0.",
            default: "0",
          },
        },
        required: [
          "agentAddress",
          "events",
          "contentURI",
          "complianceScore",
          "actionType",
        ],
      },
    },

    {
      name: "get_agent_info",
      description:
        "Fetch on-chain registration metadata and activity stats for an AI agent.",
      inputSchema: {
        type: "object",
        properties: {
          agentAddress: {
            type: "string",
            description: "Ethereum address of the agent",
          },
        },
        required: ["agentAddress"],
      },
    },

    {
      name: "get_risk_score",
      description:
        "Get the computed risk score (HIGH/MEDIUM/LOW) for a specific audit batch, " +
        "along with the action type and spend value that triggered it.",
      inputSchema: {
        type: "object",
        properties: {
          agentAddress: {
            type: "string",
            description: "Ethereum address of the agent",
          },
          batchIndex: {
            type: "number",
            description: "Zero-based index of the batch",
          },
        },
        required: ["agentAddress", "batchIndex"],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── register_agent ──────────────────────────────────────────────────────
      case "register_agent": {
        const { agentAddress, agentType, framework, network } = args as {
          agentAddress: string;
          agentType: string;
          framework: string;
          network: string;
        };

        const tx      = await auditVault.registerAgent(agentAddress, agentType, framework, network);
        const receipt = await tx.wait();

        return text({
          success:     true,
          agentAddress,
          agentType,
          framework,
          network,
          txHash:      receipt.hash,
          blockNumber: receipt.blockNumber,
        });
      }

      // ── commit_audit_batch ──────────────────────────────────────────────────
      case "commit_audit_batch": {
        const {
          agentAddress,
          events,
          contentURI,
          complianceScore,
          actionType,
          spendValue = "0",
        } = args as {
          agentAddress:    string;
          events:          string[];
          contentURI:      string;
          complianceScore: number;
          actionType:      string;
          spendValue?:     string;
        };

        const merkleRoot = buildMerkleRoot(events);

        const tx = await auditVault.commitBatch(
          agentAddress,
          merkleRoot,
          contentURI,
          events.length,
          complianceScore,
          actionType,
          BigInt(spendValue)
        );
        const receipt = await tx.wait();

        // batchIndex = new length − 1
        const batchCount = await auditVault.getBatchCount(agentAddress);
        const batchIndex = Number(batchCount) - 1;
        const rs         = await auditVault.getRiskScore(agentAddress, batchIndex);

        return text({
          success:         true,
          agentAddress,
          batchIndex,
          merkleRoot,
          eventCount:      events.length,
          actionType,
          spendValue,
          riskLevel:       RISK_LEVELS[Number(rs.level)],
          complianceScore,
          txHash:          receipt.hash,
          blockNumber:     receipt.blockNumber,
        });
      }

      // ── get_agent_info ──────────────────────────────────────────────────────
      case "get_agent_info": {
        const { agentAddress } = args as { agentAddress: string };

        const [info, eventCount, batchCount] = await Promise.all([
          auditVault.getAgentInfo(agentAddress),
          auditVault.agentEventCount(agentAddress),
          auditVault.getBatchCount(agentAddress),
        ]);

        return text({
          agentAddress,
          registered:    info.registered,
          agentType:     info.agentType,
          framework:     info.framework,
          network:       info.network,
          registeredAt:  info.registered
            ? new Date(Number(info.registeredAt) * 1000).toISOString()
            : null,
          totalEvents:   Number(info.totalEvents),
          totalBatches:  Number(batchCount),
          eventCount:    Number(eventCount),
        });
      }

      // ── get_risk_score ──────────────────────────────────────────────────────
      case "get_risk_score": {
        const { agentAddress, batchIndex } = args as {
          agentAddress: string;
          batchIndex:   number;
        };

        const rs = await auditVault.getRiskScore(agentAddress, batchIndex);

        return text({
          agentAddress,
          batchIndex,
          riskLevel:  RISK_LEVELS[Number(rs.level)],
          actionType: rs.actionType,
          spendValue: rs.spendValue.toString(),
          timestamp:  new Date(Number(rs.timestamp) * 1000).toISOString(),
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: message }, null, 2) }],
      isError: true,
    };
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function text(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("AgentAudit MCP server ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
