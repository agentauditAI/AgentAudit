"""Network configurations and deployed contract addresses for all supported chains."""

from __future__ import annotations

from typing import Dict, TypedDict


class ContractAddresses(TypedDict):
    AuditVault: str
    IncidentRegistry: str
    RiskManagementSystem: str


class NetworkConfig(TypedDict):
    chain_id: int
    rpc_url: str
    explorer: str
    contracts: ContractAddresses


NETWORKS: Dict[str, NetworkConfig] = {
    "mantle": {
        "chain_id": 5000,
        "rpc_url": "https://rpc.mantle.xyz",
        "explorer": "https://explorer.mantle.xyz",
        "contracts": {
            "AuditVault": "0x6B5BebC2f9172c6E17Df5ea59C1753D360866bDB",
            "IncidentRegistry": "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
            "RiskManagementSystem": "0x9683C026434Ff9C0Ee036d655686Be5BD3F52331",
        },
    },
    "base": {
        "chain_id": 8453,
        "rpc_url": "https://mainnet.base.org",
        "explorer": "https://basescan.org",
        "contracts": {
            "AuditVault": "0x6B5BebC2f9172c6E17Df5ea59C1753D360866bDB",
            "IncidentRegistry": "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
            "RiskManagementSystem": "0x9683C026434Ff9C0Ee036d655686Be5BD3F52331",
        },
    },
    "arbitrum": {
        "chain_id": 42161,
        "rpc_url": "https://arb1.arbitrum.io/rpc",
        "explorer": "https://arbiscan.io",
        "contracts": {
            "AuditVault": "0x6B5BebC2f9172c6E17Df5ea59C1753D360866bDB",
            "IncidentRegistry": "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
            "RiskManagementSystem": "0x9683C026434Ff9C0Ee036d655686Be5BD3F52331",
        },
    },
    "optimism": {
        "chain_id": 10,
        "rpc_url": "https://mainnet.optimism.io",
        "explorer": "https://optimistic.etherscan.io",
        "contracts": {
            "AuditVault": "0x9683C026434Ff9C0Ee036d655686Be5BD3F52331",
            "IncidentRegistry": "0x976b03a2417cf7926813605F427ED499fdF61e10",
            "RiskManagementSystem": "0x291FE7352698CDBf6816A3F61CbF14b52D6a402b",
        },
    },
    "polygon": {
        "chain_id": 137,
        "rpc_url": "https://polygon-rpc.com",
        "explorer": "https://polygonscan.com",
        "contracts": {
            "AuditVault": "0x6B5BebC2f9172c6E17Df5ea59C1753D360866bDB",
            "IncidentRegistry": "0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F",
            "RiskManagementSystem": "0x9683C026434Ff9C0Ee036d655686Be5BD3F52331",
        },
    },
}


def get_network(name: str) -> NetworkConfig:
    if name not in NETWORKS:
        raise ValueError(f"Unknown network '{name}'. Supported: {list(NETWORKS)}")
    return NETWORKS[name]
