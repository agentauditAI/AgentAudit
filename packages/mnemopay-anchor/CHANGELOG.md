# Changelog

All notable changes to `@agentauditai/mnemopay-anchor` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Changed
- Optional peer dependency `@mnemopay/sdk` raised from `>=1.14.3` to `^1.15.1`. The anchor
  seam was first published in 1.15.0, but 1.15.0 lacks the `require` export condition, so
  `require("@mnemopay/sdk/governance")` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` in CommonJS.

### Documentation
- `test/vendor/PROVENANCE.md` now records the published `@mnemopay/sdk` 1.15.0 and 1.15.1
  releases: the vendored `anchor-sink.ts` / `audit-chain.ts` compile to the same bytes as their
  `dist/governance/` files (one type-only import specifier differs in the source).
- README: install requirements updated; removed the "unmerged branch / npm latest 1.14.2" note.
