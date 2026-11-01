import json
from collections.abc import AsyncIterator

import httpx

from app.adapters.base import (
    AdapterError,
    ChatChunk,
    OpenedStream,
    ProviderAdapter,
    iter_sse_events,
    join_url,
    send_checked,
    timeout_for,
)


class OpenAIAdapter(ProviderAdapter):
    slug = "openai"
    implemented = True
    summary = (
        "OpenAI chat completions. Also the practical path for Groq, Together, "
        "DeepSeek, and vLLM: point base_url at their OpenAI-compatible /v1 root."
    )

    async def test_connection(self, client, *, base_url, api_key, timeout) -> str:
        headers = _headers(api_key)
        try:
            response = await client.get(
                join_url(base_url, "models"),
                headers=headers,
                timeout=timeout_for(min(timeout, 15)),
            )
        except httpx.TimeoutException as exc:
            raise AdapterError(504, "upstream timeout", True) from exc
        except httpx.TransportError as exc:
            raise AdapterError(502, "upstream connection failed", True) from exc
        if response.status_code >= 400:
            raise AdapterError(response.status_code, f"upstream status {response.status_code}", False)
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        count = len(data) if isinstance(data, list) else 0
        return f"reachable, {count} models listed"

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
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        request = client.build_request(
            "POST",
            join_url(base_url, "chat/completions"),
            headers=_headers(api_key),
            json=payload,
            timeout=timeout_for(timeout),
        )
        response = await send_checked(client, request)
        return OpenedStream(response=response, parser=_parse_openai)


def _headers(api_key: str | None) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    return headers


async def _parse_openai(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    async for _event, data in iter_sse_events(response):
        if not data or data == "[DONE]":
            if data == "[DONE]":
                break
            continue
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        usage = payload.get("usage") if isinstance(payload, dict) else None
        prompt_tokens = completion_tokens = None
        if isinstance(usage, dict):
            prompt_tokens = usage.get("prompt_tokens")
            completion_tokens = usage.get("completion_tokens")
        choices = payload.get("choices") if isinstance(payload, dict) else None
        content = ""
        finish = None
        if isinstance(choices, list) and choices:
            choice = choices[0] or {}
            delta = choice.get("delta") or choice.get("message") or {}
            raw_content = delta.get("content")
            if isinstance(raw_content, str):
                content = raw_content
            elif isinstance(raw_content, list):
                content = "".join(
                    part.get("text", "") for part in raw_content if isinstance(part, dict)
                )
            finish = choice.get("finish_reason")
        if content or finish or prompt_tokens is not None or completion_tokens is not None:
            yield ChatChunk(
                content=content,
                finish_reason=finish,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
