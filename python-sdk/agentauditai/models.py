from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
HarmType = Literal[
    "DEATH",
    "SERIOUS_HEALTH_HARM",
    "SIGNIFICANT_PROPERTY_DAMAGE",
    "FUNDAMENTAL_RIGHTS_VIOLATION",
    "OTHER",
]


class AgentRegistration(BaseModel):
    agent_address: str
    agent_type: str
    framework: str
    network: str
    tx_hash: str
    articles: List[str] = Field(
        default=["Art. 13", "Art. 26"],
        description="EU AI Act articles covered by this registration",
    )


class AuditAction(BaseModel):
    agent_address: str
    tx_hash: str
    network: str
    content_uri: str
    merkle_root: str
    articles: List[str] = Field(default=["Art. 12", "Art. 19"])


class RiskScore(BaseModel):
    agent_address: str
    network: str
    raw_score: int = Field(ge=0, le=255, description="On-chain compliance score (0–255)")
    score: float = Field(ge=0.0, le=1.0, description="Normalised score (0.0–1.0)")
    level: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
    compliance_status: str
    articles: List[str] = Field(default=["Art. 9"])


class ComplianceReport(BaseModel):
    agent_address: str
    network: str
    registered: bool
    agent_type: str
    framework: str
    registered_at: int
    total_events: int
    batch_count: int
    compliance_score: int
    compliance_status: str
    applicable_articles: List[str]
    obligations: List[Dict[str, Any]]


class IncidentReport(BaseModel):
    incident_id: int
    agent_address: str
    network: str
    tx_hash: str
    severity: Severity
    harm_type: HarmType
    description: str
    articles: List[str] = Field(default=["Art. 73"])
