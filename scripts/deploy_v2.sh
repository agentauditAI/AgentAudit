#!/bin/bash
source .env

echo "Deploying AgentRegistration.sol to Mantle Sepolia..."
forge create contracts/v2/AgentRegistration.sol:AgentRegistration \
  --rpc-url https://rpc.sepolia.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast

echo "Deploying AgentAuditBatch.sol to Mantle Sepolia..."
forge create contracts/v2/AgentAuditBatch.sol:AgentAuditBatch \
  --rpc-url https://rpc.sepolia.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast
