"""LangChain callback handler for AgentAudit on-chain logging."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult

from ..client import AgentAuditClient


def _hash(data: Any) -> str:
    raw = json.dumps(data, sort_keys=True, default=str) if not isinstance(data, str) else data
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()


class AgentAuditCallbackHandler(AsyncCallbackHandler):
    """
    LangChain async callback handler that logs every LLM call to AgentAudit on-chain.

    Attach to any LangChain model, chain, or agent. Works for both streaming and
    non-streaming because LangChain always fires ``on_llm_end`` with the full output.

    Concurrent ``run_id``s are tracked independently in a dict; run state is
    deleted after ``on_llm_end``.

    Args:
        client: Configured ``AgentAuditClient`` instance.
        agent_address: Ethereum address of the AI agent to log against.
        risk_level: Default risk level for audit records (HIGH | MEDIUM | LOW).
        action: Action label stored in the audit record.

    Example::

        from agentauditai import AgentAuditClient
        from agentauditai.integrations.langchain import AgentAuditCallbackHandler

        client = AgentAuditClient(network="base", private_key="0x...")
        handler = AgentAuditCallbackHandler(client, agent_address="0xYourAgent")

        llm = ChatOpenAI(callbacks=[handler])
    """

    def __init__(
        self,
        client: AgentAuditClient,
        agent_address: str,
        risk_level: str = "HIGH",
        action: str = "LLM_DECISION",
    ) -> None:
        super().__init__()
        self._client = client
        self._agent_address = agent_address
        self._risk_level = risk_level
        self._action = action
        # run_id → {"prompt_hash": str, "started_at": float}
        self._runs: Dict[str, Dict[str, Any]] = {}

    async def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        prompt_text = " ".join(m.content for batch in messages for m in batch if hasattr(m, "content"))
        self._runs[str(run_id)] = {
            "prompt_hash": _hash(prompt_text),
            "started_at": time.time(),
        }

    async def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._runs[str(run_id)] = {
            "prompt_hash": _hash(" ".join(prompts)),
            "started_at": time.time(),
        }

    async def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        run = self._runs.pop(str(run_id), {})
        response_text = ""
        for gen_list in response.generations:
            for gen in gen_list:
                text = getattr(gen, "text", None) or getattr(
                    getattr(gen, "message", None), "content", ""
                )
                if text:
                    response_text += text

        data = {
            "prompt_hash": run.get("prompt_hash", ""),
            "response_hash": _hash(response_text),
            "latency_ms": round((time.time() - run.get("started_at", time.time())) * 1000),
            "token_usage": response.llm_output or {},
        }
        asyncio.ensure_future(self._log(data))

    async def _log(self, data: Dict[str, Any]) -> None:
        try:
            await self._client.audit_action(
                agent_address=self._agent_address,
                action=self._action,
                data=data,
                risk_level=self._risk_level,  # type: ignore[arg-type]
            )
        except Exception as exc:
            import sys
            print(f"[AgentAudit] fire-and-forget audit failed: {exc}", file=sys.stderr)
