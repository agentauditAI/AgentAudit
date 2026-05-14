import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/api/**/*.test.ts", "**/test/sdk/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  transform: {
    // ethers v6 types use #privateField syntax that trips ts-jest diagnostics;
    // type safety is still enforced by the root tsconfig at build time.
    "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
  },
};

export default config;
