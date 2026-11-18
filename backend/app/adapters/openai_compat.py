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
from app.adapters.catalog import fetch_model_names


class OpenAIAdapter(ProviderAdapter):
    summary = "Chat Completions sobre la URL base compatible con OpenAI."

    def __init__(self, slug: str = "openai"):
        self.slug = slug

    async def discover_models(self, client, *, base_url, api_key, timeout) -> list[str]:
        return await fetch_model_names(client, join_url(base_url, "models"), _headers(api_key), timeout)

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
        options: dict | None = None,
    ) -> OpenedStream:
        options = options or {}
        for name in ("audio", "functions", "function_call", "top_logprobs", "web_search_options"):
            if options.get(name) is not None:
                raise AdapterError(400, f"{name} is not supported by this chat gateway", False)
        if options.get("logprobs") or options.get("modalities") not in (None, ["text"]):
            raise AdapterError(400, "logprobs and non-text output modalities are not supported", False)

        payload = {
            **options,
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


def _content_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list) and all(
        isinstance(part, dict) and isinstance(part.get("text"), str) for part in content
    ):
        return "".join(part["text"] for part in content)
    raise AdapterError(502, "unsupported upstream chat content", False)


async def _parse_openai(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    received_choice = False
    finished = False
    async for event, data in iter_sse_events(response):
        if data == "[DONE]":
            if not received_choice:
                raise AdapterError(502, "upstream returned no chat choices", False)
            return
        try:
            payload = json.loads(data)
        except ValueError as exc:
            raise AdapterError(502, "invalid upstream event", False) from exc
        if not isinstance(payload, dict) or event == "error" or payload.get("error"):
            raise AdapterError(502, "upstream chat stream failed", False)
        usage = payload.get("usage") or {}
        choices = payload.get("choices") or []
        chunk = ChatChunk(
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )
        if choices:
            if len(choices) != 1 or choices[0].get("index", 0) != 0:
                raise AdapterError(502, "unexpected number of upstream choices", False)
            received_choice = True
            choice = choices[0]
            delta = choice.get("delta") or choice.get("message") or {}
            if choice.get("logprobs") or any(delta.get(key) for key in ("audio", "function_call", "annotations")):
                raise AdapterError(502, "unsupported upstream chat output", False)
            chunk.content = _content_text(delta.get("content"))
            chunk.refusal = _content_text(delta.get("refusal"))
            chunk.reasoning_content = _content_text(delta.get("reasoning_content") or delta.get("reasoning"))
            chunk.tool_calls = delta.get("tool_calls") or []
            for call in chunk.tool_calls:
                if not isinstance(call, dict) or not isinstance(call.get("index"), int):
                    raise AdapterError(502, "upstream tool call is missing its index", False)
                if call.get("type") not in (None, "function"):
                    raise AdapterError(502, "unsupported upstream tool type", False)
            chunk.finish_reason = choice.get("finish_reason")
            finished = finished or bool(chunk.finish_reason)
        if choices or usage:
            yield chunk
    if not finished:
        raise AdapterError(502, "upstream chat stream ended unexpectedly", False)
