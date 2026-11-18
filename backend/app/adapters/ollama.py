import base64
import binascii
import json
import uuid
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
from app.adapters.catalog import fetch_model_names


class OllamaAdapter(ProviderAdapter):
    slug = "ollama"
    implemented = True
    summary = "Ollama /api/chat on localhost, a LAN host, or a tunnelled VPS. NDJSON is translated to OpenAI SSE."

    async def discover_models(self, client, *, base_url, api_key, timeout) -> list[str]:
        headers = {"authorization": f"Bearer {api_key}"} if api_key else {}
        return await fetch_model_names(
            client, _api_url(base_url, "tags"), headers, timeout, list_field="models", name_field="name"
        )

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
        payload = {
            "model": model,
            "messages": _messages(messages),
            "stream": True,
            **_chat_options(options or {}, temperature, max_tokens),
        }
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


def _invalid(message: str) -> AdapterError:
    return AdapterError(400, message, False)


def _messages(messages: list[dict]) -> list[dict]:
    converted = []
    tool_names = {}
    for item in messages:
        role = item["role"]
        if role == "developer":
            role = "system"
        if role not in ("system", "user", "assistant", "tool"):
            raise _invalid(f"Ollama does not support message role {role!r}")
        message = _message_content(role, item.get("content"))
        for key in ("function_call", "audio", "refusal"):
            if item.get(key) is not None:
                raise _invalid(f"Ollama cannot use {key!r} in chat history")
        if item.get("reasoning_content") is not None:
            if role != "assistant" or not isinstance(item["reasoning_content"], str):
                raise _invalid("reasoning_content requires an assistant message with text")
            message["thinking"] = item["reasoning_content"]
        if item.get("tool_calls"):
            if role != "assistant" or not isinstance(item["tool_calls"], list):
                raise _invalid("tool_calls must be an array on an assistant message")
            calls = []
            for call in item["tool_calls"]:
                native = _history_call(call, len(calls))
                tool_names[native["id"]] = native["function"]["name"]
                calls.append(native)
            message["tool_calls"] = calls
        if role == "tool":
            call_id = item.get("tool_call_id")
            if not isinstance(call_id, str) or call_id not in tool_names:
                raise _invalid("A tool result must reference a preceding assistant tool call")
            message["tool_call_id"] = call_id
            message["tool_name"] = tool_names[call_id]
        converted.append(message)
    return converted


def _message_content(role: str, content: object) -> dict:
    if content is None or isinstance(content, str):
        return {"role": role, "content": content or ""}
    if not isinstance(content, list):
        raise _invalid("Ollama expects text or a list of message parts")
    text, images = [], []
    for part in content:
        if not isinstance(part, dict):
            raise _invalid("Invalid Ollama message content part")
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            text.append(part["text"])
        elif part.get("type") == "image_url" and role == "user":
            images.append(_image_data(part.get("image_url")))
        else:
            raise _invalid("Ollama supports text parts and base64 image_url parts in user messages")
    message = {"role": role, "content": "".join(text)}
    if images:
        message["images"] = images
    return message


def _image_data(image: object) -> str:
    url = image.get("url") if isinstance(image, dict) else None
    if not isinstance(url, str) or not url.startswith("data:image/"):
        raise _invalid("Ollama requires a base64 image data URL")
    metadata, _, data = url.partition(",")
    if not metadata.endswith(";base64") or not data:
        raise _invalid("Ollama requires a base64 image data URL")
    try:
        base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise _invalid("Invalid base64 image data") from exc
    return data


def _history_call(call: object, index: int) -> dict:
    if not isinstance(call, dict) or call.get("type") != "function":
        raise _invalid("Ollama accepts function tool calls")
    function = call.get("function")
    if not isinstance(function, dict) or not isinstance(function.get("name"), str):
        raise _invalid("Tool call is missing its function name")
    if not isinstance(call.get("id"), str) or not call["id"]:
        raise _invalid("Tool call is missing its id")
    try:
        arguments = json.loads(function["arguments"])
    except (KeyError, TypeError, ValueError) as exc:
        raise _invalid("Tool arguments must be a JSON object encoded as a string") from exc
    if not isinstance(arguments, dict):
        raise _invalid("Tool arguments must be a JSON object")
    return {"id": call["id"], "function": {"index": index, "name": function["name"], "arguments": arguments}}


def _chat_options(options: dict, temperature: float | None, max_tokens: int | None) -> dict:
    # Ollama accepts sampling controls inside options and the format/tools at the top level.
    extra = dict(options)
    sampling = {}
    for name in ("seed", "top_p", "frequency_penalty", "presence_penalty"):
        if name in extra:
            sampling[name] = extra.pop(name)
    if temperature is not None:
        sampling["temperature"] = temperature
    limit = extra.pop("max_completion_tokens", max_tokens)
    if limit is not None:
        sampling["num_predict"] = limit
    stop = extra.pop("stop", None)
    if stop is not None:
        sampling["stop"] = [stop] if isinstance(stop, str) else stop
    payload = {"options": sampling} if sampling else {}

    effort = extra.pop("reasoning_effort", None)
    if effort is not None:
        if not isinstance(effort, str):
            raise _invalid("reasoning_effort must be a string")
        payload["think"] = False if effort == "none" else effort
    tools = extra.pop("tools", None)
    choice = extra.pop("tool_choice", "auto")
    if choice not in ("auto", "none"):
        raise _invalid("Ollama supports tool_choice auto or none")
    parallel = extra.pop("parallel_tool_calls", True)
    if tools and choice != "none" and parallel is not True:
        raise _invalid("Ollama cannot enforce parallel_tool_calls=false")
    if tools and choice != "none":
        if not isinstance(tools, list):
            raise _invalid("Ollama expects an array of function tools")
        for tool in tools:
            if not isinstance(tool, dict) or tool.get("type") != "function":
                raise _invalid("Ollama accepts function tools")
            function = tool.get("function")
            if not isinstance(function, dict) or not isinstance(function.get("name"), str):
                raise _invalid("Function tools must include a name")
            if function.get("strict"):
                raise _invalid("Ollama does not enforce strict function tools")
        payload["tools"] = tools

    response_format = extra.pop("response_format", None)
    if response_format is not None:
        if not isinstance(response_format, dict):
            raise _invalid("response_format must be an object")
        kind = response_format.get("type")
        if kind == "json_object":
            payload["format"] = "json"
        elif kind == "json_schema":
            definition = response_format.get("json_schema")
            if not isinstance(definition, dict) or not isinstance(definition.get("schema"), dict):
                raise _invalid("json_schema requires a schema object")
            payload["format"] = definition["schema"]
        elif kind != "text":
            raise _invalid("Unsupported Ollama response_format type")
    if extra.pop("modalities", ["text"]) != ["text"]:
        raise _invalid("Ollama only returns the text modality")
    if extra.pop("logprobs", False):
        raise _invalid("Ollama logprobs are not supported by this adapter")
    if extra:
        raise _invalid("Unsupported Ollama chat option: " + ", ".join(sorted(extra)))
    return payload


async def _parse_ollama(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    next_index = 0
    async for line in iter_lines(response):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AdapterError(502, "Invalid Ollama chat response", False) from exc
        if not isinstance(payload, dict):
            raise AdapterError(502, "Invalid Ollama chat response", False)
        if payload.get("error"):
            raise AdapterError(502, str(payload["error"])[:500], False)
        message = payload.get("message") or {}
        if not isinstance(message, dict):
            raise AdapterError(502, "Invalid message from Ollama", False)
        native_calls = message.get("tool_calls", [])
        if not isinstance(native_calls, list):
            raise AdapterError(502, "Invalid tool calls from Ollama", False)
        calls = []
        for call in native_calls:
            function = call.get("function") if isinstance(call, dict) else None
            if (
                not isinstance(function, dict)
                or not isinstance(function.get("name"), str)
                or not isinstance(function.get("arguments"), dict)
            ):
                raise AdapterError(502, "Invalid tool call from Ollama", False)
            calls.append({
                "index": next_index,
                "id": call.get("id") or "call_" + uuid.uuid4().hex,
                "type": "function",
                "function": {
                    "name": function["name"],
                    "arguments": json.dumps(function["arguments"], ensure_ascii=False, separators=(",", ":")),
                },
            })
            next_index += 1
        done = bool(payload.get("done"))
        reason = (payload.get("done_reason") or "stop") if done else None
        yield ChatChunk(
            content=message.get("content") or "",
            reasoning_content=message.get("thinking") or "",
            tool_calls=calls,
            finish_reason="tool_calls" if reason == "stop" and next_index else reason,
            prompt_tokens=payload.get("prompt_eval_count") if done else None,
            completion_tokens=payload.get("eval_count") if done else None,
        )
        if done:
            return
    raise AdapterError(502, "Ollama stream ended before its final message", False)
