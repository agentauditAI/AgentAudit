#!/usr/bin/env node
// AgentAudit AI — agentaudit-verify CLI.
// Usage: agentaudit-verify <bundle.json> --rpc <url> [--vault <address>] [--submitter <address>]
// Exit codes: 0 every check passed, 1 at least one check failed, 2 usage or I/O error.

import { readFileSync } from "fs";
import { EthersChainReader, verifyBundle, type ChainReader } from "./verify";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** Injected in tests; defaults to an ethers JSON-RPC reader on --rpc */
  makeReader?(rpcUrl: string): ChainReader & { destroy?(): void };
}

interface Args {
  bundlePath: string;
  rpc: string;
  vault?: string;
  submitter?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const USAGE =
  "usage: agentaudit-verify <bundle.json> --rpc <url> [--vault <address>] [--submitter <address>]";

// ─── Functions ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Args | string {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rpc" || a === "--vault" || a === "--submitter") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      flags[a.slice(2)] = v;
    } else if (a.startsWith("--")) {
      return `unknown option ${a}`;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) return "expected exactly one <bundle.json>";
  if (!flags.rpc) return "--rpc <url> is required";
  return { bundlePath: positional[0], rpc: flags.rpc, vault: flags.vault, submitter: flags.submitter };
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.err(`agentaudit-verify: ${args}`);
    io.err(USAGE);
    return 2;
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse(readFileSync(args.bundlePath, "utf8"));
  } catch (err) {
    io.err(`agentaudit-verify: cannot read ${args.bundlePath}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const reader = io.makeReader ? io.makeReader(args.rpc) : new EthersChainReader(args.rpc);
  try {
    const result = await verifyBundle(bundle, { reader, vault: args.vault, submitter: args.submitter });
    io.out(`agentaudit-verify ${args.bundlePath}`);
    io.out(`rpc ${args.rpc}`);
    const width = Math.max(...result.checks.map((c) => c.name.length));
    for (const c of result.checks) io.out(`${c.status}  ${c.name.padEnd(width)}  ${c.detail}`);
    for (const line of result.info) io.out(`INFO  ${line}`);
    const passed = result.checks.filter((c) => c.status === "PASS").length;
    io.out(`RESULT  ${result.ok ? "PASS" : "FAIL"}  ${passed}/${result.checks.length} checks passed`);
    return result.ok ? 0 : 1;
  } finally {
    reader.destroy?.();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`agentaudit-verify: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(2);
    },
  );
}
