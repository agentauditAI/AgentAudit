#!/bin/bash
source .env

echo "Deploying AgentRegistration.sol to Mantle Mainnet..."
forge create contracts/v2/AgentRegistration.sol:AgentRegistration \
  --rpc-url https://rpc.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast

echo "Deploying AgentAuditBatch.sol to Mantle Mainnet..."
forge create contracts/v2/AgentAuditBatch.sol:AgentAuditBatch \
  --rpc-url https://rpc.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast

echo "Done! Contracts deployed to Mantle Mainnet."