# agentauditai-sdk

On-chain EU AI Act compliance for AI agents — immutable audit logs, Know Your Agent (KYA) registration, incident reporting, and post-market monitoring across 5 EVM networks.

**Enforcement deadline: August 2, 2026.**

[![PyPI](https://img.shields.io/pypi/v/agentauditai-sdk)](https://pypi.org/project/agentauditai-sdk/)
[![license](https://img.shields.io/pypi/l/agentauditai-sdk)](LICENSE)
[![python](https://img.shields.io/pypi/pyversions/agentauditai-sdk)](https://pypi.org/project/agentauditai-sdk/)

---

## Installation

```bash
pip install agentauditai-sdk
```

---

## Quick Start

### 1. Register an AI agent (Art. 13, 26 — KYA standard)

```python
from agentauditai import AgentAuditClient

client = AgentAuditClient(
    api_key="your-api-key",
    base_url="https://your-agentaudit-api",
    network="base",
)

registration = client.register_agent(
    agent_id="42",
    name="customer-support-agent",
    model="claude-sonnet-4-6",
    network="base",
)

print(f"Registered: tx={registration.tx_hash}")
print(f"Articles covered: {registration.articles}")
```

### 2. Audit an agent action (Art. 12, 19 — record-keeping)

```python
from agentauditai import AgentAuditClient

client = AgentAuditClient(api_key="your-api-key", network="arbitrum")

result = client.audit_action(
    agent_id="42",
    action="LLM_DECISION",
    data={
        "prompt": "Summarise the customer complaint",
        "response": "Refund approved for order #8821",
        "model": "claude-sonnet-4-6",
    },
    risk_level="HIGH",
)

print(f"Logged on-chain: {result.tx_hash}")
print(f"Audit ID: {result.audit_id}")
print(f"Articles triggered: {result.articles}")
```

### 3. Get compliance report (Art. 72 — post-market monitoring)

```python
from agentauditai import AgentAuditClient

client = AgentAuditClient(api_key="your-api-key", network="base")

# Risk score
risk = client.get_risk_score(agent_id="42")
print(f"Risk level: {risk.level}  score: {risk.score}")
print(f"Status: {risk.compliance_status}")

# Full compliance report
report = client.get_compliance_report(agent_id="42")
print(f"Agent: {report.agent_name}")
print(f"Total actions logged: {report.total_actions_logged}")
print(f"Applicable articles: {report.applicable_articles}")
print(f"Compliance status: {report.compliance_status}")
for obligation in report.obligations:
    status = "PASS" if obligation["met"] else "FAIL"
    print(f"  [{status}] {obligation['article']} — {obligation['obligation']}")
```

---

## EU AI Act Coverage

| Article | Obligation | Method |
|---------|-----------|--------|
| Art. 9 | Risk management system | `get_risk_score()` |
| Art. 11 | Technical documentation | `register_agent()` |
| Art. 12 | Record-keeping & audit logs | `audit_action()` |
| Art. 13 | Transparency to users | `register_agent()` |
| Art. 14 | Human oversight | `audit_action()` with action tagging |
| Art. 19 | Conformity assessment logging | `audit_action()` |
| Art. 26 | Deployer obligations (KYA) | `register_agent()` |
| Art. 72 | Post-market monitoring | `get_compliance_report()` |
| Art. 73 | Serious incident reporting | `audit_action(action="REPORT_INCIDENT")` |

---

## Supported Networks

| Network | Chain ID |
|---------|----------|
| Base Mainnet | 8453 |
| Arbitrum One | 42161 |
| Optimism Mainnet | 10 |
| Polygon Mainnet | 137 |
| Mantle Mainnet | 5000 |

---

## Configuration

| Parameter | Environment Variable | Default |
|-----------|---------------------|---------|
| `api_key` | `AGENTAUDIT_API_KEY` | — |
| `base_url` | — | `http://localhost:3000` |
| `network` | — | `base` |
| `timeout` | — | `30` |

---

## Links

- Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- PyPI: [pypi.org/project/agentauditai-sdk](https://pypi.org/project/agentauditai-sdk/)
- npm: [npmjs.com/package/@agentauditai/sdk](https://www.npmjs.com/package/@agentauditai/sdk)

---

AgentAudit AI — a [RunLockAI](https://getagentaudit.xyz) product
