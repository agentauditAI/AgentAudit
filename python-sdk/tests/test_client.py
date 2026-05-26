"""Tests for AgentAuditClient — all 5 async methods, web3 fully mocked."""

from __future__ import annotations

import hashlib
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hexbytes import HexBytes

AGENT_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
NORM_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
FAKE_TX = "0xdeadbeef" + "0" * 56
FAKE_RECEIPT: dict = {
    "transactionHash": HexBytes(bytes.fromhex(FAKE_TX[2:])),
    "logs": [],
    "status": 1,
}


def _make_mock_w3(
    compliance_score: int = 210,
    agent_info: tuple = (
        True,
        "LLM_AGENT",
        "langchain",
        "base",
        1_700_000_000,
        42,
    ),
    batch_count: int = 7,
) -> MagicMock:
    """Build a fully-mocked AsyncWeb3 instance."""
    mock_w3 = MagicMock()

    # to_checksum_address is a static call used synchronously
    mock_w3.to_checksum_address = lambda addr: addr

    # eth.get_transaction_count is async
    mock_w3.eth = MagicMock()
    mock_w3.eth.get_transaction_count = AsyncMock(return_value=5)
    mock_w3.eth.send_raw_transaction = AsyncMock(return_value=bytes.fromhex(FAKE_TX[2:]))
    mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value=FAKE_RECEIPT)

    # account.sign_transaction returns an object with raw_transaction
    signed_tx = MagicMock()
    signed_tx.raw_transaction = b"\x00" * 32
    mock_account = MagicMock()
    mock_account.address = "0xSender"
    mock_account.sign_transaction = MagicMock(return_value=signed_tx)
    mock_w3.eth.account = MagicMock()
    mock_w3.eth.account.from_key = MagicMock(return_value=mock_account)
    mock_w3.eth.account.sign_transaction = MagicMock(return_value=signed_tx)

    # Contract functions
    def _make_contract(abi: Any, address: str) -> MagicMock:
        contract = MagicMock()

        # registerAgent
        register_fn = MagicMock()
        register_fn.build_transaction = AsyncMock(return_value={"to": address, "data": "0x"})
        contract.functions.registerAgent = MagicMock(return_value=register_fn)

        # commitHighRiskEvent
        commit_fn = MagicMock()
        commit_fn.build_transaction = AsyncMock(return_value={"to": address, "data": "0x"})
        contract.functions.commitHighRiskEvent = MagicMock(return_value=commit_fn)

        # getLatestComplianceScore
        score_fn = MagicMock()
        score_fn.call = AsyncMock(return_value=compliance_score)
        contract.functions.getLatestComplianceScore = MagicMock(return_value=score_fn)

        # getAgentInfo
        info_fn = MagicMock()
        info_fn.call = AsyncMock(return_value=agent_info)
        contract.functions.getAgentInfo = MagicMock(return_value=info_fn)

        # getBatchCount
        batch_fn = MagicMock()
        batch_fn.call = AsyncMock(return_value=batch_count)
        contract.functions.getBatchCount = MagicMock(return_value=batch_fn)

        # registerIncident
        incident_fn = MagicMock()
        incident_fn.build_transaction = AsyncMock(return_value={"to": address, "data": "0x"})
        contract.functions.registerIncident = MagicMock(return_value=incident_fn)

        return contract

    mock_w3.eth.contract = MagicMock(side_effect=_make_contract)
    return mock_w3


@pytest.fixture
def client():
    """AgentAuditClient with web3 patched to a mock."""
    from agentauditai import AgentAuditClient

    mock_w3 = _make_mock_w3()

    with (
        patch("agentauditai.client.AsyncWeb3") as MockAsyncWeb3,
        patch("agentauditai.client.AsyncHTTPProvider"),
    ):
        MockAsyncWeb3.return_value = mock_w3
        MockAsyncWeb3.to_checksum_address = lambda addr: addr

        c = AgentAuditClient(
            network="base",
            private_key="0x" + "a" * 64,
        )
        # Replace the internal w3 with our mock so contract calls go to it
        c._w3 = mock_w3
        c._vault = mock_w3.eth.contract(abi=[], address=AGENT_ADDR)
        c._incident = mock_w3.eth.contract(abi=[], address=AGENT_ADDR)
        yield c


# ─── register_agent ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_agent_returns_registration(client):
    result = await client.register_agent(
        agent_address=AGENT_ADDR,
        agent_type="LLM_AGENT",
        framework="langchain",
    )
    assert result.tx_hash == FAKE_TX
    assert result.agent_address == AGENT_ADDR
    assert result.agent_type == "LLM_AGENT"
    assert result.framework == "langchain"
    assert result.network == "base"
    assert "Art. 13" in result.articles
    assert "Art. 26" in result.articles


@pytest.mark.asyncio
async def test_register_agent_calls_contract(client):
    await client.register_agent(AGENT_ADDR, "RAG_AGENT", "custom")
    client._vault.functions.registerAgent.assert_called_once_with(
        AGENT_ADDR, "RAG_AGENT", "custom", "base"
    )


# ─── audit_action ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_audit_action_returns_action(client):
    result = await client.audit_action(
        agent_address=AGENT_ADDR,
        action="LLM_DECISION",
        data={"prompt": "hello", "response": "world"},
    )
    assert result.tx_hash == FAKE_TX
    assert result.agent_address == AGENT_ADDR
    assert result.network == "base"
    assert result.merkle_root.startswith("sha256:")
    assert "LLM_DECISION" in result.content_uri
    assert "Art. 12" in result.articles


@pytest.mark.asyncio
async def test_audit_action_hashes_payload(client):
    data = {"prompt": "secret", "response": "also secret"}
    result = await client.audit_action(AGENT_ADDR, "TOOL_CALL", data)
    # Raw data must NOT appear in the URI or merkle root
    assert "secret" not in result.content_uri
    assert "secret" not in result.merkle_root
    assert result.merkle_root.startswith("sha256:")


# ─── get_risk_score ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_risk_score_compliant(client):
    # Default mock score is 210 → COMPLIANT
    result = await client.get_risk_score(AGENT_ADDR)
    assert result.agent_address == AGENT_ADDR
    assert result.raw_score == 210
    assert result.level == "LOW"
    assert result.compliance_status == "COMPLIANT"
    assert 0.0 <= result.score <= 1.0
    assert "Art. 9" in result.articles


@pytest.mark.asyncio
async def test_get_risk_score_critical(client):
    # Patch score to 50 → CRITICAL
    client._vault.functions.getLatestComplianceScore.return_value.call = AsyncMock(return_value=50)
    result = await client.get_risk_score(AGENT_ADDR)
    assert result.level == "CRITICAL"
    assert result.compliance_status == "CRITICAL_NON_COMPLIANT"


@pytest.mark.asyncio
async def test_get_risk_score_unregistered(client):
    client._vault.functions.getLatestComplianceScore.return_value.call = AsyncMock(return_value=0)
    result = await client.get_risk_score(AGENT_ADDR)
    assert result.level == "UNKNOWN"
    assert result.compliance_status == "UNREGISTERED"


# ─── get_compliance_report ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_compliance_report_structure(client):
    result = await client.get_compliance_report(AGENT_ADDR)
    assert result.agent_address == AGENT_ADDR
    assert result.registered is True
    assert result.agent_type == "LLM_AGENT"
    assert result.framework == "langchain"
    assert result.total_events == 42
    assert result.batch_count == 7
    assert result.compliance_score == 210
    assert result.compliance_status == "COMPLIANT"
    assert len(result.applicable_articles) > 0
    assert all(isinstance(ob, dict) for ob in result.obligations)
    assert all("article" in ob and "obligation" in ob and "met" in ob for ob in result.obligations)


@pytest.mark.asyncio
async def test_get_compliance_report_non_compliant(client):
    client._vault.functions.getLatestComplianceScore.return_value.call = AsyncMock(return_value=100)
    result = await client.get_compliance_report(AGENT_ADDR)
    assert result.compliance_status == "NON_COMPLIANT"
    assert all(ob["met"] is False for ob in result.obligations)


# ─── report_incident ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_report_incident_returns_report(client):
    result = await client.report_incident(
        agent_address=AGENT_ADDR,
        description="Model hallucinated harmful medical advice",
        severity="HIGH",
        harm_type="SERIOUS_HEALTH_HARM",
        affected_persons=3,
    )
    assert result.tx_hash == FAKE_TX
    assert result.agent_address == AGENT_ADDR
    assert result.network == "base"
    assert result.severity == "HIGH"
    assert result.harm_type == "SERIOUS_HEALTH_HARM"
    assert result.description == "Model hallucinated harmful medical advice"
    assert "Art. 73" in result.articles


@pytest.mark.asyncio
async def test_report_incident_calls_contract_with_correct_severity(client):
    await client.report_incident(AGENT_ADDR, "test", severity="CRITICAL", harm_type="DEATH")
    call_args = client._incident.functions.registerIncident.call_args[0]
    severity_idx = call_args[1]
    harm_idx = call_args[2]
    assert severity_idx == 3  # CRITICAL = 3 in enum
    assert harm_idx == 0      # DEATH = 0 in enum


# ─── AgentAuditError ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_missing_private_key_raises(client):
    client._private_key = None
    with pytest.raises(Exception, match="private_key"):
        await client.register_agent(AGENT_ADDR)
