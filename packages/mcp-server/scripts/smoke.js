// Smoke test for the compiled package: starts the built bin with plain node
// (no ts-node) over stdio and lists its tools. No RPC calls, no key needed.
const path = require("path");
const os = require("os");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const EXPECTED = [
  "audit_action", "check_conformity", "get_audit_log", "get_compliance_report",
  "get_risk_score", "report_incident", "verify_proof",
];

async function main() {
  const bin = path.join(__dirname, "..", "dist", "src", "mcp-server.js");
  const env = { ...process.env };
  delete env.PRIVATE_KEY;
  const client = new Client({ name: "mcp-server-smoke", version: "0" });
  // cwd outside the repo so dotenv cannot pick up a local .env
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], cwd: os.tmpdir(), env, stderr: "inherit" }));
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) {
      throw new Error(`unexpected tools: ${names.join(", ")}`);
    }
    console.log(`smoke ok: ${names.length} tools (${names.join(", ")})`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("smoke failed:", err.message);
  process.exit(1);
});
