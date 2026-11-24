# Vendored StarClaw fixture (test-only)

| | |
|---|---|
| Upstream | https://github.com/mnemopay/starclaw |
| Path | `tests/fixtures/starclaw-chainbundle/v1/` |
| Commit | `2c501044db446eabc1c142d9e35c01fd55f1e4e0` (`main`, 2026-11-22, "Merge pull request #40 from mnemopay/site/version-alpha14") |
| Release | npm `starclaw@2.0.0-alpha.14` (published 2026-11-22T12:10:07Z, integrity `sha512-gYdSo5/ianXItAhpgUnAOvzyT+2RxFchqPeFKerYKOJFoYnD+KfulpRWJ6ak5f4VgH15MT7kLcw9umQdJeCFSA==`) |
| License | Apache-2.0, see `LICENSE` and `NOTICE` (copied verbatim from the upstream repository root) |
| Vendored | 2026-11-24 |

All files are byte-for-byte copies with no changes. The root `.gitattributes` entry
`fixtures/starclaw-chainbundle/** -text` keeps git from rewriting them
(upstream uses `* -text` in the fixture directory for the same reason).

| File here | Upstream path | SHA-256 |
|---|---|---|
| `audit.jsonl` | `tests/fixtures/starclaw-chainbundle/v1/audit.jsonl` | `834d926eb299b58d484f639fb1a5120c563b426e193f61a8b5f277bb13cf8c01` |
| `audit.jsonl.head` | `tests/fixtures/starclaw-chainbundle/v1/audit.jsonl.head` | `8533ae7e44152cf5fe29c3f68c741c2d0c0ac6e61eabde8591ca5faecada1bea` |
| `chain-bundle.json` | `tests/fixtures/starclaw-chainbundle/v1/chain-bundle.json` | `54f963b67973e6a81e07741d62e799008583e80d9e9f30dc09c6469f4824abfc` |
| `expected.json` | `tests/fixtures/starclaw-chainbundle/v1/expected.json` | `a52f4265b8c54d5da10bd8e228b1555a0673efbb75504ea14575f2e2c31c2c60` |
| `pubkey.txt` | `tests/fixtures/starclaw-chainbundle/v1/pubkey.txt` | `89e2aacb14c2612a4bf1e9e71e55ec569e633614362cb358ebce7be8254a76cb` |
| `README.md` | `tests/fixtures/starclaw-chainbundle/v1/README.md` | `59a727c985ed618b6c1d95add3e3d7090444c0be038cbc714b7f3e28348a1da1` |
| `LICENSE` | `LICENSE` | `7873570e31841e5b4f48e8f34fe8f352f26609262394707f3e7f6107ca6b52e2` |
| `NOTICE` | `NOTICE` | `cf286376f859157a828ad2433ca2551cb39de46f5f5405253518e1ab18f81079` |

`chain-bundle.json` matches the `chain_bundle_sha256` pinned in `expected.json` and in
upstream `README.md`.

## Scope

Used only by `packages/mnemopay-anchor/test/fixture.starclaw.test.ts` (offline) and
`packages/mnemopay-anchor/test/fixture.starclaw.anvil.test.ts` (local anvil). Nothing
in the repository depends on `starclaw` at runtime or as a dev dependency.

This is a versioned fixture directory: never edit it. A new upstream version goes into
`fixtures/starclaw-chainbundle/v2/` with its own provenance.
