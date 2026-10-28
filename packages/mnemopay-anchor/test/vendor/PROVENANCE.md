# Vendored MnemoPay sources (test-only)

| | |
|---|---|
| Upstream | https://github.com/mnemopay/mnemopay-sdk |
| Branch | `feat/onchain-anchor-sink` (unmerged; npm `@mnemopay/sdk` latest is 1.14.2 and has no anchor seam) |
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

These files are used only by tests. The package itself (`src/`) imports nothing
from here and nothing from `@mnemopay/sdk` at runtime.

To refresh: re-clone upstream at the new commit, re-copy with the same header,
update the table above, and re-run `npx jest packages/mnemopay-anchor`.
