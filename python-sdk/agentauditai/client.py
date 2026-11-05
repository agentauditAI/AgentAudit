"""Async AgentAudit client — direct on-chain interaction via web3.py."""

from __future__ import annotations

import hashlib
import json
import os
import time
import warnings
from typing import Any, Dict, Literal, Optional

from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.types import TxReceipt

from .models import (
    AgentRegistration,
    AuditAction,
    EvidenceReport,
    HarmType,
    IncidentReport,
    RiskScore,
    Severity,
)
from .utils.networks import NETWORKS, get_network

Network = Literal["mantle", "base", "arbitrum", "optimism", "polygon"]

_SEVERITY_INDEX: Dict[str, int] = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
_HARM_INDEX: Dict[str, int] = {
    "DEATH": 0,
    "SERIOUS_HEALTH_HARM": 1,
    "SIGNIFICANT_PROPERTY_DAMAGE": 2,
    "FUNDAMENTAL_RIGHTS_VIOLATION": 3,
    "OTHER": 4,
}

_AUDIT_VAULT_ABI = [
    {
        "type": "function",
        "name": "registerAgent",
        "inputs": [
            {"name": "agentId", "type": "address"},
            {"name": "agentType", "type": "string"},
            {"name": "framework", "type": "string"},
            {"name": "network", "type": "string"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "type": "function",
        "name": "commitHighRiskEvent",
        "inputs": [
            {"name": "agentId", "type": "address"},
            {"name": "merkleRoot", "type": "bytes32"},
            {"name": "contentURI", "type": "string"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "type": "function",
        "name": "getAgentInfo",
        "inputs": [{"name": "agentId", "type": "address"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "registered", "type": "bool"},
                    {"name": "agentType", "type": "string"},
                    {"name": "framework", "type": "string"},
                    {"name": "network", "type": "string"},
                    {"name": "registeredAt", "type": "uint256"},
                    {"name": "totalEvents", "type": "uint256"},
                ],
            }
        ],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "getBatchCount",
        "inputs": [{"name": "agentId", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "getLatestComplianceScore",
        "inputs": [{"name": "agentId", "type": "address"}],
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "isRegistered",
        "inputs": [{"name": "agentId", "type": "address"}],
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
    },
]

_INCIDENT_REGISTRY_ABI = [
    {
        "type": "function",
        "name": "registerIncident",
        "inputs": [
            {"name": "agentId", "type": "bytes32"},
            {"name": "severity", "type": "uint8"},
            {"name": "harmType", "type": "uint8"},
            {"name": "description", "type": "string"},
            {"name": "evidenceHash", "type": "string"},
            {"name": "affectedPersons", "type": "uint256"},
            {"name": "occurredAt", "type": "uint256"},
        ],
        "outputs": [{"name": "id", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "type": "function",
        "name": "getAgentIncidents",
        "inputs": [{"name": "agentId", "type": "bytes32"}],
        "outputs": [{"type": "uint256[]"}],
        "stateMutability": "view",
    },
]

class AgentAuditError(Exception):
    """Raised on on-chain or configuration errors."""


class AgentAuditClient:
    """
    Async client for direct on-chain AgentAudit interactions.

    Provides on-chain evidence for AI agents: audit logs, KYA registration,
    self-reported scores, evidence reports and incident records across
    Mantle, Base, Arbitrum, Optimism, and Polygon. It does not determine
    whether any legal obligation is satisfied.

    Args:
        network: EVM network name (mantle | base | arbitrum | optimism | polygon).
        rpc_url: Override the default public RPC URL for the network.
        private_key: Hex private key for signing transactions. Falls back to
            AGENTAUDIT_PRIVATE_KEY env var. Read-only calls work without it.
        audit_vault_address: Override the deployed AuditVault contract address.
        incident_registry_address: Override the IncidentRegistry address.
    """

    def __init__(
        self,
        network: Network = "base",
        rpc_url: Optional[str] = None,
        private_key: Optional[str] = None,
        audit_vault_address: Optional[str] = None,
        incident_registry_address: Optional[str] = None,
    ) -> None:
        config = get_network(network)
        self._network = network
        self._chain_id = config["chain_id"]

        url = rpc_url or config["rpc_url"]
        self._w3 = AsyncWeb3(AsyncHTTPProvider(url))

        self._private_key = private_key or os.environ.get("AGENTAUDIT_PRIVATE_KEY")

        vault_addr = audit_vault_address or config["contracts"]["AuditVault"]
        incident_addr = incident_registry_address or config["contracts"]["IncidentRegistry"]

        self._vault = self._w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(vault_addr),
            abi=_AUDIT_VAULT_ABI,
        )
        self._incident = self._w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(incident_addr),
            abi=_INCIDENT_REGISTRY_ABI,
        )

    # ─── Helpers ───

    def _require_key(self) -> str:
        if not self._private_key:
            raise AgentAuditError(
                "A private_key is required for write operations. "
                "Pass it to AgentAuditClient() or set AGENTAUDIT_PRIVATE_KEY."
            )
        return self._private_key

    async def _send(self, fn: Any, from_address: str) -> TxReceipt:
        key = self._require_key()
        nonce = await self._w3.eth.get_transaction_count(from_address)
        tx = await fn.build_transaction(
            {"from": from_address, "nonce": nonce, "chainId": self._chain_id}
        )
        signed = self._w3.eth.account.sign_transaction(tx, key)
        tx_hash = await self._w3.eth.send_raw_transaction(signed.raw_transaction)
        return await self._w3.eth.wait_for_transaction_receipt(tx_hash)

    @staticmethod
    def hash_payload(data: Any) -> str:
        """Return sha256:<hex> of a JSON-serialisable payload. Raw content never hits the chain."""
        raw = json.dumps(data, sort_keys=True) if not isinstance(data, str) else data
        return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def _to_bytes32(text: str) -> bytes:
        return hashlib.sha256(text.encode()).digest()

    # ─── Public API ───

    async def register_agent(
        self,
        agent_address: str,
        agent_type: str = "LLM_AGENT",
        framework: str = "custom",
        network_tag: Optional[str] = None,
    ) -> AgentRegistration:
        """
        Register an AI agent on-chain (Art. 13, 26 — KYA standard).

        Writes an immutable REGISTER_AGENT record to the AuditVault,
        establishing the agent's identity and framework on the selected network.

        Args:
            agent_address: Checksummed Ethereum address of the AI agent.
            agent_type: Human-readable agent type (e.g. "LLM_AGENT", "RAG_AGENT").
            framework: Framework identifier (e.g. "langchain", "openai", "custom").
            network_tag: Optional metadata string stored in the contract (defaults to network name).
        """
        checksummed = AsyncWeb3.to_checksum_address(agent_address)
        net_tag = network_tag or self._network
        account = self._w3.eth.account.from_key(self._require_key())
        receipt = await self._send(
            self._vault.functions.registerAgent(checksummed, agent_type, framework, net_tag),
            account.address,
        )
        return AgentRegistration(
            agent_address=checksummed,
            agent_type=agent_type,
            framework=framework,
            network=self._network,
            tx_hash="0x" + receipt["transactionHash"].hex(),
        )

    async def audit_action(
        self,
        agent_address: str,
        action: str,
        data: Dict[str, Any],
        risk_level: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH",
    ) -> AuditAction:
        """
        Log an agent action on-chain (Art. 12, 19 — record-keeping).

        The payload is hashed client-side; only the SHA-256 digest (as bytes32
        merkle root) and a content URI are stored on-chain.

        Args:
            agent_address: Checksummed Ethereum address of the AI agent.
            action: Action label (e.g. "LLM_DECISION", "TOOL_CALL").
            data: Arbitrary dict describing the action — hashed, never stored raw.
            risk_level: Risk label for this action.
        """
        checksummed = AsyncWeb3.to_checksum_address(agent_address)
        payload_hash = self.hash_payload({"action": action, "data": data, "risk": risk_level})
        merkle_root = bytes.fromhex(payload_hash.removeprefix("sha256:"))
        content_uri = f"agentaudit:{self._network}:{action}:{payload_hash}"

        account = self._w3.eth.account.from_key(self._require_key())
        receipt = await self._send(
            self._vault.functions.commitHighRiskEvent(checksummed, merkle_root, content_uri),
            account.address,
        )
        return AuditAction(
            agent_address=checksummed,
            tx_hash="0x" + receipt["transactionHash"].hex(),
            network=self._network,
            content_uri=content_uri,
            merkle_root=payload_hash,
        )

    async def get_risk_score(self, agent_address: str) -> RiskScore:
        """
        Return the self-reported on-chain score for an agent (related to Art. 9).

        Reads the latest score from AuditVault and maps it to a normalised
        0.0–1.0 float and a label. The score is supplied by the caller who
        committed the batch, so this is not a risk assessment.

        Args:
            agent_address: Checksummed Ethereum address of the AI agent.
        """
        checksummed = AsyncWeb3.to_checksum_address(agent_address)
        raw: int = await self._vault.functions.getLatestComplianceScore(checksummed).call()

        normalised = round(raw / 255.0, 4)
        if raw >= 200:
            level = "LOW"
        elif raw >= 150:
            level = "MEDIUM"
        elif raw >= 80:
            level = "HIGH"
        elif raw > 0:
            level = "CRITICAL"
        else:
            level = "UNKNOWN"

        return RiskScore(
            agent_address=checksummed,
            network=self._network,
            raw_score=raw,
            score=normalised,
            level=level,
        )

    async def get_evidence_report(self, agent_address: str) -> EvidenceReport:
        """
        List the on-chain records found for an agent.

        Reads agent registration info, batch count and the self-reported score
        from AuditVault. It does not determine whether any legal obligation is
        satisfied.

        Args:
            agent_address: Checksummed Ethereum address of the AI agent.
        """
        checksummed = AsyncWeb3.to_checksum_address(agent_address)

        info = await self._vault.functions.getAgentInfo(checksummed).call()
        batch_count: int = await self._vault.functions.getBatchCount(checksummed).call()
        score: int = await self._vault.functions.getLatestComplianceScore(checksummed).call()

        registered, agent_type, framework, network_tag, registered_at, total_events = info

        return EvidenceReport(
            agent_address=checksummed,
            network=self._network,
            registered=registered,
            agent_type=agent_type,
            framework=framework,
            registered_at=registered_at,
            total_events=total_events,
            batch_count=batch_count,
            self_reported_score=score,
        )

    async def get_compliance_report(self, agent_address: str) -> EvidenceReport:
        """Deprecated alias of get_evidence_report; removed in a future major version."""
        warnings.warn(
            "get_compliance_report is deprecated; use get_evidence_report",
            DeprecationWarning,
            stacklevel=2,
        )
        return await self.get_evidence_report(agent_address)

    async def report_incident(
        self,
        agent_address: str,
        description: str,
        severity: Severity = "HIGH",
        harm_type: HarmType = "OTHER",
        affected_persons: int = 0,
        evidence: Optional[str] = None,
        occurred_at: Optional[int] = None,
    ) -> IncidentReport:
        """
        Record a serious incident on-chain (related to Art. 73).

        Writes an incident record to the IncidentRegistry. This is an on-chain
        record, not a report to any authority, and it calculates no legal deadline.

        Args:
            agent_address: Checksummed Ethereum address of the AI agent.
            description: Human-readable incident description.
            severity: LOW | MEDIUM | HIGH | CRITICAL.
            harm_type: Nature of harm per Art. 73§1 qualifying conditions.
            affected_persons: Estimated number of people affected.
            evidence: Optional content URI / IPFS CID for evidence artefacts.
            occurred_at: Unix timestamp of when the incident occurred (defaults to now).
        """
        checksummed = AsyncWeb3.to_checksum_address(agent_address)
        agent_id_bytes32 = self._to_bytes32(checksummed)
        evidence_hash = evidence or self.hash_payload(description)
        ts = occurred_at or int(time.time())

        account = self._w3.eth.account.from_key(self._require_key())

        fn = self._incident.functions.registerIncident(
            agent_id_bytes32,
            _SEVERITY_INDEX[severity],
            _HARM_INDEX[harm_type],
            description,
            evidence_hash,
            affected_persons,
            ts,
        )
        receipt = await self._send(fn, account.address)

        # Extract incident ID from logs if available, else use 0 as sentinel
        incident_id = 0
        if receipt.get("logs"):
            try:
                incident_id = int.from_bytes(receipt["logs"][0]["data"][:32], "big")
            except Exception:
                pass

        return IncidentReport(
            incident_id=incident_id,
            agent_address=checksummed,
            network=self._network,
            tx_hash="0x" + receipt["transactionHash"].hex(),
            severity=severity,
            harm_type=harm_type,
            description=description,
        )
