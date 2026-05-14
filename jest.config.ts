import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/api/**/*.test.ts", "**/test/sdk/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
};

export default config;
