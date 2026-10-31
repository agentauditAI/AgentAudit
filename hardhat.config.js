require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const fs = require("fs");
const path = require("path");

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

// contracts/v3/** is pinned to solc 0.8.38 / evm prague (docs/design/AUDITVAULT_V3.md §9).
// Per-file overrides, not a second entry in `compilers`: Hardhat picks the newest
// matching compiler per file, which would move every ^0.8.20 contract to 0.8.38.
// Hardhat checks every file in the import graph, so the OpenZeppelin files v3
// imports (lib/openzeppelin-contracts, only used by v3) get the same override.
const V3_COMPILER = {
  version: "0.8.38",
  settings: {
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "prague",
  },
};
function solFiles(relDir) {
  const dir = path.join(__dirname, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith(".sol"))
    .map((f) => `${relDir}/${f.split(path.sep).join("/")}`);
}
const v3Overrides = Object.fromEntries(
  [...solFiles("contracts/v3"), ...solFiles("lib/openzeppelin-contracts/contracts")].map((f) => [f, V3_COMPILER]),
);

module.exports = {
  solidity: {
    // `compilers` form: the `version` shorthand drops `overrides`
    compilers: [
      {
        version: "0.8.20",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
    overrides: v3Overrides,
  },
  networks: {
    // ── Testnets ──────────────────────────────────────────────────────────
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts,
      chainId: 421614,
    },
    mantleSepolia: {
      url: process.env.MANTLE_SEPOLIA_RPC_URL || "https://rpc.sepolia.mantle.xyz",
      accounts,
      chainId: 5003,
    },
    // ── Mainnets ──────────────────────────────────────────────────────────
    mantle: {
      url: process.env.MANTLE_RPC_URL || "https://rpc.mantle.xyz",
      accounts,
      chainId: 5000,
    },
    arbitrumOne: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts,
      chainId: 42161,
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts,
      chainId: 8453,
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      accounts,
      chainId: 10,
      gasPrice: 2000000, // 0.002 gwei — outbids stuck txs on Optimism
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
      accounts,
      chainId: 137,
    },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      accounts,
      chainId: 46630,
    },
  },
};