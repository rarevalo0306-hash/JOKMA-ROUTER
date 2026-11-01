import json
from collections.abc import AsyncIterator

import httpx

from app.adapters.base import (
    AdapterError,
    ChatChunk,
    OpenedStream,
    ProviderAdapter,
    iter_sse_events,
    send_checked,
    timeout_for,
)
from app.tokens import content_to_text

ANTHROPIC_VERSION = "2023-06-01"


class AnthropicAdapter(ProviderAdapter):
    slug = "anthropic"
    implemented = True
    summary = "Anthropic Messages API. Streams are translated to OpenAI chat chunks."

    async def test_connection(self, client, *, base_url, api_key, timeout) -> str:
        if not api_key:
            raise AdapterError(401, "provider API key is not configured", False)
        try:
            response = await client.get(
                _models_url(base_url),
                headers=_headers(api_key),
                timeout=timeout_for(min(timeout, 15)),
            )
        except httpx.TimeoutException as exc:
            raise AdapterError(504, "upstream timeout", True) from exc
        except httpx.TransportError as exc:
            raise AdapterError(502, "upstream connection failed", True) from exc
        if response.status_code >= 400:
            raise AdapterError(response.status_code, f"upstream status {response.status_code}", False)
        return "reachable"

    async def open_chat(
        self,
        client,
        *,
        base_url,
        api_key,
        model,
        messages,
        temperature,
        max_tokens,
        timeout,
    ) -> OpenedStream:
        if not api_key:
            raise AdapterError(401, "provider API key is not configured", False)
        system, converted = _to_anthropic_messages(messages)
        if not converted:
            raise AdapterError(400, "Anthropic requires at least one user or assistant message", False)
        payload: dict = {
            "model": model,
            "max_tokens": max_tokens or 1024,
            "messages": converted,
            "stream": True,
        }
        if system:
            payload["system"] = system
        if temperature is not None:
            payload["temperature"] = temperature
        request = client.build_request(
            "POST",
            _messages_url(base_url),
            headers=_headers(api_key),
            json=payload,
            timeout=timeout_for(timeout),
        )
        response = await send_checked(client, request)
        return OpenedStream(response=response, parser=_parse_anthropic)


def _headers(api_key: str) -> dict[str, str]:
    return {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
    }


def _messages_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return base + "/messages"
    return base + "/v1/messages"


def _models_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return base + "/models"
    return base + "/v1/models"


def _to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    converted: list[dict] = []
    for message in messages:
        role = message.get("role") or "user"
        text = content_to_text(message.get("content"))
        if role == "system":
            if text:
                system_parts.append(text)
            continue
        if role not in ("user", "assistant"):
            role = "user"
        if converted and converted[-1]["role"] == role:
            converted[-1]["content"] += "\n" + text
        else:
            converted.append({"role": role, "content": text})
    return "\n".join(system_parts), converted


async def _parse_anthropic(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    async for _event, data in iter_sse_events(response):
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        kind = payload.get("type")
        if kind == "message_start":
            usage = (payload.get("message") or {}).get("usage") or {}
            yield ChatChunk(
                prompt_tokens=usage.get("input_tokens"),
                completion_tokens=usage.get("output_tokens"),
            )
        elif kind == "content_block_delta":
            delta = payload.get("delta") or {}
            if delta.get("type") == "text_delta":
                yield ChatChunk(content=delta.get("text") or "")
        elif kind == "message_delta":
            usage = payload.get("usage") or {}
            stop = (payload.get("delta") or {}).get("stop_reason")
            yield ChatChunk(
                completion_tokens=usage.get("output_tokens"),
                finish_reason="stop" if stop else None,
            )
        elif kind == "error":
            error = payload.get("error") or {}
            raise AdapterError(502, str(error.get("message") or "anthropic stream error"), False)
