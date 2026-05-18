require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
    },
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
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts,
      chainId: 137,
    },
  },
};