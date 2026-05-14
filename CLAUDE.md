# AgentAudit — Project Rules for Claude Code

## Project Overview

AgentAudit is an on-chain compliance infrastructure for AI agents under the EU AI Act (enforcement deadline: **August 2, 2026**). It provides immutable audit logs, Know Your Agent (KYA) registration, post-market monitoring, and incident tracking as Solidity smart contracts.

- **v1**: `contracts/v1/AuditVault_v1.sol` — legacy, deployed on Mantle Mainnet
- **v2**: `contracts/v2/` — active development, multi-contract compliance stack

## Tech Stack

| Layer | Tool |
|---|---|
| Smart contracts | Solidity 0.8.20 |
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
contracts/v2/    ← production contracts (active development)
contracts/v1/    ← legacy v1 (do not modify)
test/            ← Foundry test files (*.t.sol)
test/api/        ← Jest + supertest API tests (*.test.ts)
src/api/         ← REST API gateway (Express + TypeScript)
sdk/src/         ← TypeScript SDK wrapping on-chain contracts
scripts/         ← Hardhat deployment scripts
docs/            ← Architecture, compliance, threat-model docs
lib/forge-std/   ← Foundry standard library (do not edit)
out/             ← Foundry build artifacts (do not edit or commit)
```

## Solidity Conventions

- `pragma solidity ^0.8.20;` on every file
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
