// Shared anvil setup for the *.anvil.test.ts suites — same rules as
// test/sdk/batch.anvil.test.ts: needs Foundry (`anvil`) and out/ from
// `forge build`; fails without them unless AGENTAUDIT_SKIP_ANVIL=1 is set.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { ethers } from "ethers";

// anvil default account #0 — public test key, never used outside local chains
export const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ARTIFACT = path.join(__dirname, "../../../out/AuditVault.sol/AuditVault.json");

export const SKIP_ANVIL = process.env.AGENTAUDIT_SKIP_ANVIL === "1";
export const describeAnvil = SKIP_ANVIL ? describe.skip : describe;

export interface AnvilEnv {
  rpc: string;
  provider: ethers.JsonRpcProvider;
  vaultAddress: string;
  vault: ethers.Contract;
  stop(): void;
}

function hasAnvil(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Fresh anvil + AuditVault v2 deployed by account #0 at nonce 0 */
export async function startAnvil(port: number): Promise<AnvilEnv> {
  if (!hasAnvil()) {
    throw new Error("anvil not found on PATH — install Foundry (https://getfoundry.sh) or set AGENTAUDIT_SKIP_ANVIL=1 to skip");
  }
  if (!existsSync(ARTIFACT)) throw new Error(`Missing ${ARTIFACT} — run \`forge build\` first`);
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));

  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpc = `http://127.0.0.1:${port}`;
  // Wait with plain fetch: an ethers provider created before anvil listens can
  // stall in network detection
  for (let i = 0; ; i++) {
    try {
      await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      break;
    } catch {
      if (i > 100) {
        anvil.kill();
        throw new Error("anvil did not start");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const deployer = new ethers.Wallet(KEY, provider);
  const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer).deploy();
  await deployed.waitForDeployment();
  const vaultAddress = await deployed.getAddress();

  return {
    rpc,
    provider,
    vaultAddress,
    vault: new ethers.Contract(vaultAddress, artifact.abi, provider),
    stop() {
      provider.destroy();
      anvil.kill();
    },
  };
}
