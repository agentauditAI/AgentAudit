import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "**/test/api/**/*.test.ts",
    "**/test/sdk/**/*.test.ts",
    "**/test/mcp/**/*.test.ts",
    "**/test/plugin/**/*.test.js",
    "**/packages/*/test/**/*.test.ts",
    "**/tools/*/test/**/*.test.ts",
  ],
  moduleFileExtensions: ["ts", "js"],
  // plugin-elizaos depends on the published @agentauditai/sdk; in-repo tests run
  // it against the local SDK source instead.
  moduleNameMapper: {
    "^@agentauditai/sdk$": "<rootDir>/sdk/src/index.ts",
    // A nested node_modules (e.g. after `npm install` in plugin-elizaos/) would
    // load a second, unmocked ethers; pin every import to the root copy.
    "^ethers$": "<rootDir>/node_modules/ethers",
  },
  transform: {
    // ethers v6 types use #privateField syntax that trips ts-jest diagnostics;
    // type safety is still enforced by the root tsconfig at build time.
    "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
  },
};

export default config;
