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


EVIDENCE_DISCLAIMER = (
    "This output lists on-chain records. The score is reported by the caller and "
    "AuditVault v2 does not verify who commits a batch. It does not determine whether "
    "any obligation under the EU AI Act or any other law is satisfied. Not legal advice."
)


class RiskScore(BaseModel):
    agent_address: str
    network: str
    raw_score: int = Field(ge=0, le=255, description="Self-reported on-chain score (0–255)")
    score: float = Field(ge=0.0, le=1.0, description="Normalised score (0.0–1.0)")
    level: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] = Field(
        description="Label derived from the self-reported score; not a risk assessment"
    )
    articles: List[str] = Field(default=["Art. 9"], description="Related articles")
    disclaimer: str = EVIDENCE_DISCLAIMER


class EvidenceReport(BaseModel):
    agent_address: str
    network: str
    registered: bool
    agent_type: str
    framework: str
    registered_at: int
    total_events: int
    batch_count: int
    self_reported_score: int = Field(description="Score supplied by the caller; unverified")
    related_articles: List[str] = Field(default=["Art. 12", "Art. 19", "Art. 26"])
    disclaimer: str = EVIDENCE_DISCLAIMER


# Deprecated name, kept so existing imports keep working
ComplianceReport = EvidenceReport


class IncidentReport(BaseModel):
    incident_id: int
    agent_address: str
    network: str
    tx_hash: str
    severity: Severity
    harm_type: HarmType
    description: str
    articles: List[str] = Field(default=["Art. 73"])
