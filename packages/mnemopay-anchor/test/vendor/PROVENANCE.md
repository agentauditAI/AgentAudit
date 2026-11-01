# Vendored MnemoPay sources (test-only)

| | |
|---|---|
| Upstream | https://github.com/mnemopay/mnemopay-sdk |
| Branch | `feat/onchain-anchor-sink`, since merged and published in `@mnemopay/sdk` 1.15.0 and 1.15.1 (see below) |
| Commit | `3896f7083b79259b514e8e3b90f854da6cfe2d9b` |
| License | Apache-2.0, see `LICENSE` and `NOTICE` (copied verbatim) |
| Vendored | 2026-10-27 |

| File here | Upstream path | Upstream SHA-256 | Changes |
|---|---|---|---|
| `anchor-sink.ts` | `src/governance/anchor-sink.ts` | `cd27ee3115e1738900afd39123e04d110ed59a1c8104b7076918a1abd9ab04c4` | Header added; `"./audit-chain.js"` → `"./audit-chain"` for CommonJS ts-jest |
| `audit-chain.ts` | `src/governance/audit-chain.ts` | `94c160ce94f8890b16a14efb60870e62b83ed9aeb87b79f5c2d512c6acf42bdf` | Header added only |
| `LICENSE` | `LICENSE` | `7873570e31841e5b4f48e8f34fe8f352f26609262394707f3e7f6107ca6b52e2` | none |
| `NOTICE` | `NOTICE` | `4c826097f495535465d6dc2a8c08a2b33b108249bda2131bb46f1a990a253e99` | none |

The contract tests in `../contract.anvil.test.ts` are ported from upstream
`tests/governance/anchor-sink.test.ts`
(SHA-256 `e42a367b604107249fa5e315d188e1487ae52897bd8b34fe94a554e5ce204539`),
vitest → jest, retargeted from `MockAnchorSink` to `AuditVaultAnchorSink` on anvil.

## Published releases

Checked 2026-11-01 against the npm registry and the upstream repository.

| Release | Git | Tarball integrity (recomputed from the tarball, matches registry) |
|---|---|---|
| `@mnemopay/sdk@1.15.0` | annotated tag `v1.15.0` → `c69d3b563872cdec81dc864b252cfd83c1de8d00` (= registry `gitHead`) | `sha512-5OcC98pdjjFsyS8TdzizG5vcydCgyuLg/LuUwx7a05fELCL6dO+byIyMSER1v4tUogpBHvFH/FXiQ3lPMxbNqQ==` |
| `@mnemopay/sdk@1.15.1` | registry `gitHead` `c91dc529fd0b8c12401a3619563c2758b51946c8`; **no git tag** | `sha512-am+WPJgclqcARagSQVRItZRF5SHvrf3cBeRATETGguhK/C/1R59m+YxVUtsgVQ2Bg+R+bQO4ov6U65MNspAEaA==` |

The tarballs ship compiled output only (no `.ts`, source maps without
`sourcesContent`). These files are byte-identical in 1.15.0 and 1.15.1:

| Published file | SHA-256 |
|---|---|
| `dist/governance/anchor-sink.js` | `a110b304d30c22832f6d416381591cd671b59656d072f1d220fdb9d656071fcb` |
| `dist/governance/anchor-sink.d.ts` | `8b2f4ae721279f42a86bb077e222c2102c25082f5e6d6fdf4bfae696b345a60b` |
| `dist/governance/audit-chain.js` | `034a2c688e81b9b20c25fdbd2278715cd91e208810c8c2aee168568a905aed7d` |
| `dist/governance/audit-chain.d.ts` | `2130b3f6c9a6a5e954705c6fe81bbc7ac8c0f7a7b29ea3a96101e91542f49cf1` |

- Upstream `src/governance/anchor-sink.ts` (`cd27ee3115e1738900afd39123e04d110ed59a1c8104b7076918a1abd9ab04c4`)
  and `src/governance/audit-chain.ts` (`94c160ce94f8890b16a14efb60870e62b83ed9aeb87b79f5c2d512c6acf42bdf`)
  are identical at `3896f70`, `c69d3b5` and `c91dc52`, as are `LICENSE`, `NOTICE` and
  `tests/governance/anchor-sink.test.ts`.
- Compiling those two sources with upstream's `tsconfig.json` at `c69d3b5` (TypeScript 5.9.3;
  ES2022, NodeNext, declaration + maps) reproduces the four published files above byte for byte.
- Our vendored copies equal those sources apart from the 7-line header and one line in
  `anchor-sink.ts`: `import type { ChainBundle } from "./audit-chain.js";` →
  `from "./audit-chain";` (CommonJS ts-jest resolution; type-only import, erased at compile time).

The tests keep this vendored copy instead of depending on `@mnemopay/sdk`: the published
package pulls in dependencies with native install scripts (`better-sqlite3`,
`onnxruntime-node`), which we don't want in the repository install and CI for two test-only files.

## Scope

These files are used only by tests. The package itself (`src/`) imports nothing
from here and nothing from `@mnemopay/sdk` at runtime.

To refresh: re-clone upstream at the new commit, re-copy with the same header,
update the table above, and re-run `npx jest packages/mnemopay-anchor`.
