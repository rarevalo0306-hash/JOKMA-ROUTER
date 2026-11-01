import json
from collections.abc import AsyncIterator

import httpx

from app.adapters.base import (
    AdapterError,
    ChatChunk,
    OpenedStream,
    ProviderAdapter,
    iter_lines,
    send_checked,
    timeout_for,
)
from app.tokens import content_to_text


class OllamaAdapter(ProviderAdapter):
    slug = "ollama"
    implemented = True
    summary = "Ollama /api/chat on localhost, a LAN host, or a tunnelled VPS. NDJSON is translated to OpenAI SSE."

    async def test_connection(self, client, *, base_url, api_key, timeout) -> str:
        headers = {"content-type": "application/json"}
        if api_key:
            headers["authorization"] = f"Bearer {api_key}"
        try:
            response = await client.get(
                _api_url(base_url, "tags"),
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
        models = payload.get("models") if isinstance(payload, dict) else None
        count = len(models) if isinstance(models, list) else 0
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
            "messages": [
                {"role": item.get("role") or "user", "content": content_to_text(item.get("content"))}
                for item in messages
            ],
            "stream": True,
        }
        options: dict = {}
        if temperature is not None:
            options["temperature"] = temperature
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if options:
            payload["options"] = options
        headers = {"content-type": "application/json"}
        if api_key:
            headers["authorization"] = f"Bearer {api_key}"
        request = client.build_request(
            "POST",
            _api_url(base_url, "chat"),
            headers=headers,
            json=payload,
            timeout=timeout_for(timeout),
        )
        response = await send_checked(client, request)
        return OpenedStream(response=response, parser=_parse_ollama)


def _api_url(base_url: str, method: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/api"):
        return f"{base}/{method}"
    return f"{base}/api/{method}"


async def _parse_ollama(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    async for line in iter_lines(response):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("error"):
            raise AdapterError(502, str(payload["error"])[:500], False)
        message = payload.get("message") or {}
        done = bool(payload.get("done"))
        yield ChatChunk(
            content=message.get("content") or "",
            finish_reason="stop" if done else None,
            prompt_tokens=payload.get("prompt_eval_count") if done else None,
            completion_tokens=payload.get("eval_count") if done else None,
        )
