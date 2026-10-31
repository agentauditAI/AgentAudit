# AgentAudit — Project Rules for Claude Code

## Project Overview

AgentAudit is an on-chain compliance infrastructure for AI agents under the EU AI Act (enforcement deadline: **August 2, 2026**). It provides immutable audit logs, Know Your Agent (KYA) registration, post-market monitoring, and incident tracking as Solidity smart contracts.

- **v1**: `contracts/v1/AuditVault_v1.sol` — legacy, deployed on Mantle Mainnet
- **v2**: `contracts/v2/` — active development, multi-contract compliance stack

## Tech Stack

| Layer | Tool |
|---|---|
| Smart contracts | Solidity 0.8.20 (Hardhat, v1/v2); forge pinned to 0.8.35 (`compilation_restrictions`, v2/src/script); `contracts/v3/` exactly 0.8.38, evm `prague` |
| Testing | Foundry (`forge test`) |
| Deployment | Hardhat (`npm run deploy:<network>`) |
| Networks | Mantle Mainnet, Arbitrum One (+ testnets) |
| Off-chain storage | IPFS / Arweave (content URIs, Merkle roots on-chain) |

## Commands

```bash
forge build               # compile contracts
forge test                # run all Foundry tests
forge test -vvv           # verbose output, show traces
forge test --match-test test_<name>   # run a single test
forge fmt                 # format Solidity
npm run test:api          # run Jest API tests (test/api/)
npm run api               # start API gateway on port 3000
npm run deploy:mantle     # deploy to Mantle Mainnet
npm run deploy:arbitrum   # deploy to Arbitrum One
```

## File Layout

```
contracts/v2/        ← production contracts (active development)
contracts/v1/        ← legacy v1 (do not modify)
test/                ← Foundry test files (*.t.sol)
test/api/            ← Jest + supertest API tests
test/sdk/            ← Jest SDK wrapper tests
src/api/             ← REST API gateway (Express + TypeScript)
src/mcp-server.ts    ← MCP server (`npm run mcp`); `createServer(options)` + stdio entry. audit_action / get_audit_log / verify_proof use AuditVault v2 (Base; `AUDIT_VAULT_<NETWORK>` overrides), Phase 7 tools use deployments/phase7-*.json
test/mcp/            ← anvil tests for every MCP tool (same AGENTAUDIT_SKIP_ANVIL rule as the SDK anvil tests)
sdk/src/index.ts     ← core AgentAudit SDK (ethers v6, on-chain logging)
sdk/src/openai.ts    ← AuditedOpenAI wrapper
sdk/src/anthropic.ts ← AuditedAnthropic wrapper
sdk/src/langchain.ts ← AgentAuditCallbackHandler + withAudit()
plugin-elizaos/      ← ElizaOS plugin (do not modify — separately versioned)
packages/mnemopay-anchor/ ← @agentauditai/mnemopay-anchor: MnemoPay OnChainAnchorSink on AuditVault v2 commitBatch (test/vendor/ = vendored MnemoPay, Apache-2.0, do not edit)
packages/mcp-server/ ← @agentauditai/mcp-server (bin `agentaudit-mcp`): compiles src/mcp-server.ts + the sdk/tools/verify modules it imports with plain tsc (rootDir = repo root → dist/src, dist/sdk/src, dist/tools/verify/src, dist/deployments); `npm run build` / `smoke`; CI builds, smokes and checks the pack list — never `npm publish` from CI
tools/verify/        ← agentaudit-verify CLI: standalone Evidence Schema v1 bundle verifier (ethers only; no imports from sdk/ or packages/)
fixtures/            ← shared cross-project fixtures (versioned dirs, never edit an existing version)
test/plugin/         ← Jest tests for the ElizaOS plugin (CommonJS .js)
scripts/             ← Hardhat deployment scripts
docs/                ← Architecture, compliance, threat-model docs
lib/forge-std/       ← Foundry standard library (do not edit)
lib/openzeppelin-contracts/ ← OpenZeppelin v5.7.0, tag commit cab19933c33c2ad1d4c7a84864a3601dddfd16f3, `contracts/` + LICENSE only (vendored, do not edit); used only by contracts/v3/
contracts/v3/        ← AuditVault v3 (docs/design/AUDITVAULT_V3.md); toolchain skeleton only so far
out/                 ← Foundry build artifacts (do not edit or commit)
```

## Solidity Conventions

- `pragma solidity ^0.8.20;` on every file — **except `contracts/v3/`**, which uses the exact `pragma solidity 0.8.38;` (design doc §9, §13.2 follow-up 3). Re-check solc `bugs.json` / `bugs_by_version.json` for 0.8.38 before any v3 deploy
- **v3 toolchain is scoped** so existing bytecode never changes:
  - `foundry.toml` `compilation_restrictions` pin `contracts/v3/**` to 0.8.38 / `prague` (profile `v3`) and `contracts/v2/**`, `src/**`, `script/**` to 0.8.35 (what auto-detect produced); `hardhat.config.js` overrides only `contracts/v3/**` and `lib/openzeppelin-contracts/**` to 0.8.38 / `prague`
  - `auto_detect_remappings = false` with only `forge-std/` remapped: any remapping (even a `contracts/v3/:` context one) is recorded in every contract's metadata and changes its bytecode. v3 imports OpenZeppelin by **relative path** (`../../lib/openzeppelin-contracts/contracts/...`), which Hardhat also resolves
  - forge v1.7.1 cannot auto-install 0.8.38: run `./scripts/install-solc.sh` once (checksum-verified official binary into the svm dir); CI does the same
- `// SPDX-License-Identifier: MIT` header
- NatSpec on contracts: `@title`, `@notice`, `@dev`, `@custom:article`
- Section separators use the `// ─── Section Name ───` style (box-drawing dashes)
- Structs, enums, and events are grouped under a `// ─── Types ───` section
- State variables under `// ─── Storage ───`, functions under `// ─── Functions ───`
- Use `custom errors` (not `require` strings) — e.g., `error AlreadyEnrolled(address agent)`
- Numeric values that need decimals are scaled by `1e4` (e.g., compliance scores 0–10000)
- `address public immutable deployer` pattern for contract ownership
- EU AI Act article references go in NatSpec `@dev` or `@custom:article` tags

## Test Conventions

- Test files: `test/<ContractName>.t.sol`, contract name `<Name>Test is Test`
- Import: `import "forge-std/Test.sol";`
- Actors declared at top: `address owner = makeAddr("owner");`
- Private setup helpers prefixed with `_`: `function _enroll() internal { ... }`
- Every public test named `test_<action>_<condition>` (e.g., `test_enroll_revertsIfAlreadyEnrolled`)
- Use `vm.prank`, `vm.expectEmit`, `vm.expectRevert(abi.encodeWithSelector(...))` — never raw string reverts
- Aim for 100% branch coverage; each contract's test suite is tracked in commit messages as `N/N tests passing`
- Do not write tests that only check happy-path; always cover access-control and edge cases

## EU AI Act Compliance Mapping

| Contract | Article |
|---|---|
| `AuditVault.sol` | Art. 12, 13, 19 |
| `AgentRegistration.sol` | Art. 26 (deployer obligations) |
| `PostMarketMonitor.sol` | Art. 72 |
| `IncidentRegistry.sol` | Art. 73 |
| `EUAIActReporter.sol` | General reporting |
| `AgentIdentityRegistry.sol` | Art. 26 / KYA standard |

When adding features, note the relevant article in NatSpec.

## Security Rules

- Never store private keys or mnemonics in code; use `.env` (gitignored)
- Do not use `tx.origin` for authorization
- Prefer `custom errors` over `require(false, "string")` for gas and clarity
- Reentrancy: use checks-effects-interactions order; add `nonReentrant` only when state is mutated before an external call
- Access control: all privileged functions must revert with a typed custom error when called by unauthorized callers, and must have a corresponding test

## SDK Wrappers (`sdk/src/`)

All three wrappers share the same principles:
- **Batch anchoring by default** — `mode: "batch"` (default) buffers one `action_ref` per call in a `BatchBuffer` (`sdk/src/batch.ts`) and anchors a Merkle root via AuditVault v2 `commitBatch` (flush at 50 entries / 60 s / `flush()`); `mode: "per_action"` keeps the legacy `logAction` call. Scope format `llm_call:<model>:record_hash:<sha256(JCS(record))>` — see `docs/EVIDENCE_SCHEMA.md`
- **Hashed payloads** — `prompt_hash` and `response_hash` are `sha256:` digests; raw content never touches the chain (see `docs/payload-best-practices.md`)
- **`actionType`** is always `"LLM_DECISION"`
- **`riskLevel`** defaults to `"HIGH"` if omitted
- Tests in `test/sdk/*.test.ts` — AgentAudit SDK and LLM clients are fully mocked; no real network or API calls. Exception: `test/sdk/batch.anvil.test.ts` and `test/sdk/incident.anvil.test.ts` spawn a local `anvil` and deploy AuditVault v2 / IncidentRegistry v2 from `out/` (needs Foundry + `forge build`; fails if `anvil` is missing unless `AGENTAUDIT_SKIP_ANVIL=1` is set)
- **ts-jest `diagnostics: false`** is set in `jest.config.ts` because ethers v6 uses `#privateField` syntax in `.d.ts` files that trips ts-jest type-checking; root `tsconfig.json` still enforces types at build time

### `sdk/src/openai.ts` — `AuditedOpenAI`

Drop-in replacement for the `OpenAI` client. Wraps `chat.completions.create`.

- **Non-streaming**: awaits audit before returning (batch mode: buffering, plus the flush if this entry fills the batch); throws if audit fails
- **Streaming**: returns `AsyncIterable<ChatCompletionChunk>` via passthrough async generator; logs in `finally` block (fire-and-forget, errors go to `console.error`)

### `sdk/src/anthropic.ts` — `AuditedAnthropic`

Drop-in replacement for the `Anthropic` client. Wraps `messages.create`.

- Same streaming/non-streaming split as `AuditedOpenAI`
- `system` prompt is included in `prompt_hash`; `has_system: boolean` is recorded in the audit record
- Response text is extracted by concatenating all `type: "text"` content blocks
- Streaming accumulates text from `content_block_delta` + `text_delta` events; reads `input_tokens` from `message_start`, `output_tokens` from `message_delta`

### `sdk/src/langchain.ts` — `AgentAuditCallbackHandler` + `withAudit()`

Extends `BaseCallbackHandler` — the idiomatic LangChain approach. Attach to any model, chain, or agent; works for both streaming and non-streaming because LangChain always fires `handleLLMEnd` with the full output.

- `handleChatModelStart` / `handleLLMStart` — store start time + prompt hash keyed by `runId`
- `handleLLMEnd` — build audit record, log on-chain (fire-and-forget)
- Concurrent `runId`s are tracked independently in a `Map`; run state is deleted after `handleLLMEnd`
- Token extraction handles both OpenAI format (`tokenUsage.promptTokens`) and Anthropic format (`usage.input_tokens`)
- `withAudit(model, config)` — convenience helper: attaches the callback via `.withConfig({ callbacks: [...] })`

## API Gateway (`src/api/`)

- Entry point: `src/api/server.ts` — imports `app.ts` and calls `listen(3000)`
- App factory: `src/api/app.ts` — exported separately so tests can import without binding a port
- Chain connector: `src/api/chain.ts` — wraps ethers v6, one client per network; addresses come from env vars (`AUDIT_BATCH_<NETWORK>`, `REGISTRATION_<NETWORK>`); Mantle mainnet has default fallback addresses
- Auth: `Authorization: Bearer <token>`, key stored in `API_KEY` env var; health endpoint is exempt
- Validation: Zod schemas in `types.ts` — use `validateBody()` middleware; `agent_id` must be a numeric string (on-chain uint256)
- **Zod v4 quirk**: `z.record()` requires two args — always write `z.record(z.string(), z.unknown())`
- **Express 5 typing quirk**: `req.params.x` is typed `string | string[]` — always cast with `String(req.params.x)`
- Networks: mantle, base, arbitrum, optimism, polygon — base/arbitrum/optimism/polygon require env vars to be set or routes return 503
- Tests live in `test/api/server.test.ts` using Jest + supertest; the `chain.ts` module is mocked entirely — tests never touch a real network

## ElizaOS Plugin (`plugin-elizaos/`)

The plugin is a standalone CommonJS package — **do not modify it** without understanding its versioning separately from the rest of the repo.

- Entry point: `plugin-elizaos/index.js`; exports `agentAuditPlugin` with `name`, `description`, `actions[]`, `middleware`, and `batch` (`flush`/`close`/`pending`/`getInclusionProof`)
- Depends on `@agentauditai/sdk` (^1.1.2): audit logging uses `BatchBuffer` + `commitBatch` (scope `agent_action:elizaos:record_hash:…`, `docs/EVIDENCE_SCHEMA.md` §2.5); `REGISTER_AGENT` and `REPORT_INCIDENT` use the SDK (`reportIncident()` → IncidentRegistry v2 7-arg `registerIncident`; bytes32 `agentId` passes through unhashed); `RECORD_METRIC` still calls its contract via `ethers` (the SDK equivalent re-encodes `txRef`)
- Reads config from `AUDIT_*` env vars: `AUDIT_PRIVATE_KEY`, `AUDIT_NETWORK`, `AUDIT_AGENT_ID`, `AUDIT_MONITOR_ADDRESS`, `AUDIT_AUTO_LOG`, `AUDIT_REGISTRATION_ADDRESS`; optional `AUDIT_BATCH_DIR`, `AUDIT_RPC_URL`, `AUDIT_VAULT_ADDRESS`, `AUDIT_INCIDENT_REGISTRY` (defaults to the SDK's per-network IncidentRegistry v2)
- 6 actions: `REGISTER_AGENT`, `LOG_AUDIT`, `LOG_AUDIT_BATCH`, `REPORT_INCIDENT`, `RECORD_METRIC`, `AUDIT_STATUS`
- Batch anchoring works by default only on `base`; on other networks logging fails with the SDK's "Batch anchoring is not available…" error unless `AUDIT_VAULT_ADDRESS` is set
- **Known quirk (TODO in `plugin-elizaos/CHANGELOG.md`)**: `RECORD_METRIC` uses `options?.metricType || 3` — so `metricType: 0` silently falls back to `3` (uses `||` not `??`); `REPORT_INCIDENT` was fixed in 1.1.1
- Middleware buffers an `AUTO_LOG` entry for every message when `AUDIT_AUTO_LOG=true` without awaiting it; failures are swallowed silently so the agent is never blocked

### Plugin test conventions (`test/plugin/index.test.js`)

- CommonJS `.js` file — picked up by jest config via `**/test/plugin/**/*.test.js`; `@agentauditai/sdk` is mapped to `sdk/src/index.ts` by `moduleNameMapper` in `jest.config.ts`
- `ethers` is partially mocked (only `JsonRpcProvider` / `Wallet` / `Contract`, hashing stays real) and the SDK's `AgentAudit` client is mocked, so the real `BatchBuffer` runs — no real RPC calls
- Call `plugin.batch._reset()` in `beforeEach`; point `AUDIT_BATCH_DIR` at a temp dir
- `test/plugin/plugin.anvil.test.js` runs plugin actions against a real AuditVault v2 + IncidentRegistry v2 on anvil (same `AGENTAUDIT_SKIP_ANVIL` rule as the SDK anvil tests)
- Env vars are set at the top of the file (before `require`) so the plugin's load-time `console.warn` is suppressed
- `mockContract` is rebuilt in `beforeEach` so each test starts with a clean mock
- Action handlers are accessed by name: `plugin.actions.find(a => a.name === "LOG_AUDIT")`
- Always test both `validate` (env var presence) and `handler` (happy path + error path) for every action

## Known Follow-ups

- `scripts/deploy.ts` has 18 pre-existing `tsc` errors (root `npx tsc --noEmit`); the SDK build (`sdk/tsconfig.json`) is clean
- `RECORD_METRIC` `metricType || 3` quirk (see ElizaOS plugin section)

## What Not to Do

- Do not modify `contracts/v1/` — it is deployed and immutable on mainnet
- Do not edit files under `lib/` or `out/`
- Do not commit `.env` files
- Do not use `console.log` (Hardhat) in production contracts; import `forge-std/console.sol` only in test files
- Do not add abstract base contracts or inheritance unless the contract family genuinely shares state — prefer composition

## Git

- Branch from `main`; PR back to `main`
- Commit message format: `feat: <ContractName>.sol — <Article reference>, N/N tests passing`
- Git user for this repo: `agentauditAI`
