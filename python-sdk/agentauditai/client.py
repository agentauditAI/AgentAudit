import hashlib
import json
import os
from typing import Any, Dict, Literal, Optional

import requests

from .models import AgentRegistration, AuditAction, ComplianceReport, RiskScore

Network = Literal["mantle", "base", "arbitrum", "optimism", "polygon"]
RiskLevel = Literal["HIGH", "MEDIUM", "LOW"]

NETWORKS = {
    "mantle":   {"chain_id": 5000,  "explorer": "https://explorer.mantle.xyz"},
    "base":     {"chain_id": 8453,  "explorer": "https://basescan.org"},
    "arbitrum": {"chain_id": 42161, "explorer": "https://arbiscan.io"},
    "optimism": {"chain_id": 10,    "explorer": "https://optimistic.etherscan.io"},
    "polygon":  {"chain_id": 137,   "explorer": "https://polygonscan.com"},
}


class AgentAuditError(Exception):
    """Raised when the AgentAudit API returns an error."""


class AgentAuditClient:
    """
    Python client for the AgentAudit REST API.

    Provides EU AI Act compliance for AI agents: immutable on-chain audit logs,
    Know Your Agent (KYA) registration, risk scoring, and compliance reporting
    across Mantle, Base, Arbitrum, Optimism, and Polygon.

    Args:
        api_key: Bearer token for the AgentAudit API. Falls back to
            AGENTAUDIT_API_KEY environment variable.
        base_url: Base URL of the AgentAudit API gateway (default: localhost:3000).
        network: Default network for all operations.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3000",
        network: Network = "base",
        timeout: int = 30,
    ) -> None:
        self._api_key = api_key or os.environ.get("AGENTAUDIT_API_KEY", "")
        self._base_url = base_url.rstrip("/")
        self._network = network
        self._timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        })

    # ─── Internal ───

    def _post(self, path: str, body: dict) -> dict:
        resp = self._session.post(
            f"{self._base_url}{path}", json=body, timeout=self._timeout
        )
        if not resp.ok:
            raise AgentAuditError(f"API error {resp.status_code}: {resp.text}")
        return resp.json()

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        resp = self._session.get(
            f"{self._base_url}{path}", params=params, timeout=self._timeout
        )
        if not resp.ok:
            raise AgentAuditError(f"API error {resp.status_code}: {resp.text}")
        return resp.json()

    # ─── Public API ───

    @staticmethod
    def hash_payload(data: Any) -> str:
        """SHA-256 hash of a payload. Raw content never leaves your system."""
        raw = json.dumps(data, sort_keys=True) if not isinstance(data, str) else data
        return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    def register_agent(
        self,
        agent_id: str,
        name: str,
        model: str,
        network: Optional[Network] = None,
        risk_level: RiskLevel = "HIGH",
    ) -> AgentRegistration:
        """
        Register an AI agent on-chain (Art. 13, 26 — KYA standard).

        Writes an immutable REGISTER_AGENT record to the audit vault,
        establishing the agent's identity and model on the selected network.
        """
        net = network or self._network
        resp = self._post("/v1/audit", {
            "agent_id": str(agent_id),
            "action": "REGISTER_AGENT",
            "decision": f"Agent '{name}' registered with model '{model}'",
            "risk_level": risk_level,
            "network": net,
            "metadata": {"name": name, "model": model},
        })
        return AgentRegistration(
            agent_id=str(agent_id),
            name=name,
            model=model,
            network=net,
            audit_id=resp.get("audit_id"),
            tx_hash=resp.get("tx_hash"),
            registered_at=resp.get("timestamp"),
            articles=resp.get("articles", []),
        )

    def audit_action(
        self,
        agent_id: str,
        action: str,
        data: Dict[str, Any],
        risk_level: RiskLevel = "HIGH",
        network: Optional[Network] = None,
    ) -> AuditAction:
        """
        Log an agent action on-chain (Art. 12, 19 — record-keeping).

        The raw payload is hashed client-side; only the SHA-256 digest is
        stored on-chain so sensitive data never touches the chain.
        """
        net = network or self._network
        resp = self._post("/v1/audit", {
            "agent_id": str(agent_id),
            "action": action,
            "decision": self.hash_payload(data),
            "risk_level": risk_level,
            "network": net,
            "metadata": data,
        })
        return AuditAction(
            audit_id=resp["audit_id"],
            agent_id=str(agent_id),
            action=action,
            tx_hash=resp["tx_hash"],
            network=net,
            articles=resp.get("articles", []),
            timestamp=resp["timestamp"],
        )

    def get_risk_score(
        self,
        agent_id: str,
        network: Optional[Network] = None,
    ) -> RiskScore:
        """
        Return the current risk score for an agent (Art. 9 — risk management).

        Score is derived from the agent's on-chain compliance level:
        high → 1.0, limited → 0.5, minimal → 0.2.
        """
        net = network or self._network
        data = self._get(f"/v1/audit/{agent_id}/report", {"network": net})
        compliance_level = data["agent"]["compliance_level"].upper()
        score_map = {"HIGH": 1.0, "LIMITED": 0.5, "MINIMAL": 0.2}
        return RiskScore(
            agent_id=str(agent_id),
            network=net,
            level=compliance_level,
            score=score_map.get(compliance_level, 0.5),
            articles=data["eu_ai_act_compliance"]["applicable_articles"],
            compliance_status=data["eu_ai_act_compliance"]["compliance_status"],
        )

    def get_compliance_report(
        self,
        agent_id: str,
        network: Optional[Network] = None,
    ) -> ComplianceReport:
        """
        Generate a full EU AI Act compliance report for an agent (Art. 72).

        Pulls on-chain registration data and the full audit trail to produce
        a structured report covering all applicable articles.
        """
        net = network or self._network
        data = self._get(f"/v1/audit/{agent_id}/report", {"network": net})
        agent = data["agent"]
        summary = data["audit_summary"]
        compliance = data["eu_ai_act_compliance"]
        return ComplianceReport(
            agent_id=str(agent_id),
            network=net,
            generated_at=data["generated_at"],
            agent_name=agent["name"],
            compliance_level=agent["compliance_level"],
            active=agent["active"],
            total_actions_logged=summary["total_actions_logged"],
            first_action=summary.get("first_action"),
            last_action=summary.get("last_action"),
            applicable_articles=compliance["applicable_articles"],
            compliance_status=compliance["compliance_status"],
            obligations=compliance.get("obligations", []),
        )
