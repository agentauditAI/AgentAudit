// Test-only helper: ERC-8021 suffixes from `ox/erc8021` (devDependency, ESM-only).
// Run as a child process by test/sdk/attribution.test.ts so jest/ts-jest (CommonJS)
// never has to load ox. Runtime code must not import ox.
//
// Usage: node ox-erc8021.mjs '[["code"], ["a","b"]]'  → JSON array of suffix hex strings
import { Attribution } from "ox/erc8021";

const cases = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(cases.map((codes) => Attribution.toDataSuffix({ codes }))));
