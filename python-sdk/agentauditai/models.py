from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class AgentRegistration:
    agent_id: str
    name: str
    model: str
    network: str
    audit_id: Optional[str] = None
    tx_hash: Optional[str] = None
    registered_at: Optional[str] = None
    articles: List[str] = field(default_factory=list)


@dataclass
class AuditAction:
    audit_id: str
    agent_id: str
    action: str
    tx_hash: str
    network: str
    articles: List[str]
    timestamp: str


@dataclass
class RiskScore:
    agent_id: str
    network: str
    level: str
    score: float
    articles: List[str]
    compliance_status: str


@dataclass
class ComplianceReport:
    agent_id: str
    network: str
    generated_at: str
    agent_name: str
    compliance_level: str
    active: bool
    total_actions_logged: int
    first_action: Optional[str]
    last_action: Optional[str]
    applicable_articles: List[str]
    compliance_status: str
    obligations: List[Dict[str, Any]]
