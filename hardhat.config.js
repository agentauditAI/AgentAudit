require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.20",
  networks: {
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 421614,
    },
    mantleSepolia: {
      url: "https://rpc.sepolia.mantle.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 5003,
    },
    mantle: {
      url: "https://rpc.mantle.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 5000,
    },
  },
};