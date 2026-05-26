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

For the LangChain integration:

```bash
pip install "agentauditai-sdk[langchain]"
```

---

## Quick Start

### 1. Register an AI agent (Art. 13, 26 — KYA standard)

```python
import asyncio
from agentauditai import AgentAuditClient

async def main():
    client = AgentAuditClient(
        network="base",
        private_key="0xYourPrivateKey",  # or set AGENTAUDIT_PRIVATE_KEY
    )

    reg = await client.register_agent(
        agent_address="0xYourAgentAddress",
        agent_type="LLM_AGENT",
        framework="langchain",
    )
    print(f"Registered: tx={reg.tx_hash}")
    print(f"Articles covered: {reg.articles}")

asyncio.run(main())
```

### 2. Audit an agent action (Art. 12, 19 — record-keeping)

```python
result = await client.audit_action(
    agent_address="0xYourAgentAddress",
    action="LLM_DECISION",
    data={
        "prompt": "Summarise the customer complaint",
        "response": "Refund approved for order #8821",
        "model": "claude-sonnet-4-6",
    },
    risk_level="HIGH",
)
print(f"Logged on-chain: {result.tx_hash}")
print(f"Merkle root: {result.merkle_root}")   # sha256: digest — raw data stays local
```

### 3. Get risk score (Art. 9 — risk management)

```python
risk = await client.get_risk_score(agent_address="0xYourAgentAddress")
print(f"Level: {risk.level}   Score: {risk.score:.2f}")
print(f"Status: {risk.compliance_status}")
```

### 4. Get compliance report (Art. 72 — post-market monitoring)

```python
report = await client.get_compliance_report(agent_address="0xYourAgentAddress")
print(f"Registered: {report.registered}")
print(f"Total events logged: {report.total_events}")
print(f"Compliance: {report.compliance_status}")
for ob in report.obligations:
    status = "PASS" if ob["met"] else "FAIL"
    print(f"  [{status}] {ob['article']} — {ob['obligation']}")
```

### 5. Report a serious incident (Art. 73 — incident reporting)

```python
incident = await client.report_incident(
    agent_address="0xYourAgentAddress",
    description="Model produced harmful medical advice for 3 users",
    severity="HIGH",
    harm_type="SERIOUS_HEALTH_HARM",
    affected_persons=3,
)
print(f"Incident #{incident.incident_id} recorded: {incident.tx_hash}")
```

---

## LangChain Integration

Attach `AgentAuditCallbackHandler` to any LangChain model, chain, or agent.
Every LLM call is logged to the chain automatically (fire-and-forget, never blocks inference).

```python
from agentauditai import AgentAuditClient
from agentauditai.integrations.langchain import AgentAuditCallbackHandler
from langchain_openai import ChatOpenAI

client = AgentAuditClient(network="base", private_key="0x...")
handler = AgentAuditCallbackHandler(
    client,
    agent_address="0xYourAgentAddress",
    risk_level="HIGH",
)

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])
response = await llm.ainvoke("Summarise the customer complaint")
```

---

## EU AI Act Coverage

| Article | Obligation | Method |
|---------|-----------|--------|
| Art. 9  | Risk management system | `get_risk_score()` |
| Art. 12 | Record-keeping & audit logs | `audit_action()` |
| Art. 13 | Transparency / KYA | `register_agent()` |
| Art. 19 | Conformity assessment logging | `audit_action()` |
| Art. 26 | Deployer obligations | `register_agent()` |
| Art. 72 | Post-market monitoring | `get_compliance_report()` |
| Art. 73 | Serious incident reporting | `report_incident()` |

---

## Supported Networks

| Network | Chain ID | Contract (AuditVault) |
|---------|----------|-----------------------|
| Base Mainnet | 8453 | `0x6B5BebC2...` |
| Arbitrum One | 42161 | `0x6B5BebC2...` |
| Optimism Mainnet | 10 | `0x9683C026...` |
| Polygon Mainnet | 137 | `0x6B5BebC2...` |
| Mantle Mainnet | 5000 | `0x6B5BebC2...` |

```python
from agentauditai.utils.networks import NETWORKS

print(NETWORKS["base"]["chain_id"])   # 8453
print(NETWORKS["base"]["contracts"]["AuditVault"])
```

---

## Configuration

| Parameter | Environment Variable | Default |
|-----------|---------------------|---------|
| `private_key` | `AGENTAUDIT_PRIVATE_KEY` | — |
| `network` | — | `base` |
| `rpc_url` | — | public RPC for the network |

---

## Privacy

Raw prompts and responses **never** leave your system.
Only the SHA-256 hash of the payload (`sha256:<hex>`) is committed on-chain as a bytes32 merkle root.

```python
# Inspect what goes on-chain — always a hash, never raw content
AgentAuditClient.hash_payload({"prompt": "secret", "response": "also secret"})
# → 'sha256:3e23e81...'
```

---

## Links

- Website: [getagentaudit.xyz](https://getagentaudit.xyz)
- PyPI: [pypi.org/project/agentauditai-sdk](https://pypi.org/project/agentauditai-sdk/)
- npm: [npmjs.com/package/@agentauditai/sdk](https://www.npmjs.com/package/@agentauditai/sdk)

---

AgentAudit AI — a [RunLockAI](https://getagentaudit.xyz) product
