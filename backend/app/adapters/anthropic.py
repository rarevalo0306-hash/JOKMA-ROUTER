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
from app.adapters.catalog import fetch_model_names

ANTHROPIC_VERSION = "2023-06-01"


class AnthropicAdapter(ProviderAdapter):
    slug = "anthropic"
    implemented = True
    summary = "Anthropic Messages API. Streams are translated to OpenAI chat chunks."

    async def discover_models(self, client, *, base_url, api_key, timeout) -> list[str]:
        if not api_key:
            raise AdapterError(401, "provider API key is not configured", False)
        return await fetch_model_names(
            client, _models_url(base_url), _headers(api_key), timeout, anthropic_pages=True
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
        _apply_options(payload, options or {})
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


def _invalid(message: str) -> AdapterError:
    return AdapterError(400, message, False)


def _image_block(part: dict) -> dict:
    image = part.get("image_url")
    url = image.get("url") if isinstance(image, dict) else None
    if not isinstance(url, str):
        raise _invalid("image_url requires a URL")
    if url.startswith("data:"):
        media_type, separator, data = url[5:].partition(";base64,")
        if not separator or not data or media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            raise _invalid("Anthropic expects a base64 JPEG, PNG, GIF or WebP image")
        source = {"type": "base64", "media_type": media_type, "data": data}
    elif url.startswith(("https://", "http://")):
        source = {"type": "url", "url": url}
    else:
        raise _invalid("Anthropic image URLs must use HTTP, HTTPS or base64 image data")
    return {"type": "image", "source": source}


def _content_blocks(content, *, allow_images: bool = False) -> list[dict]:
    if content is None:
        return []
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    if not isinstance(content, list):
        raise _invalid("Invalid Anthropic message content")
    blocks = []
    for part in content:
        if isinstance(part, str):
            part = {"type": "text", "text": part}
        if not isinstance(part, dict):
            raise _invalid("Invalid Anthropic content part")
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            if part["text"]:
                blocks.append({"type": "text", "text": part["text"]})
        elif part.get("type") == "image_url" and allow_images:
            blocks.append(_image_block(part))
        else:
            raise _invalid("Unsupported content part for this Anthropic message")
    return blocks


def _tool_use(call: dict) -> dict:
    if not isinstance(call, dict) or call.get("type") != "function" or not call.get("id"):
        raise _invalid("Anthropic requires an id for each function call")
    function = call.get("function")
    if not isinstance(function, dict) or not function.get("name"):
        raise _invalid("A tool call requires a function name")
    try:
        arguments = json.loads(function["arguments"])
    except (KeyError, TypeError, ValueError) as exc:
        raise _invalid("Invalid JSON in tool call arguments") from exc
    if not isinstance(arguments, dict):
        raise _invalid("Tool call arguments must be a JSON object")
    return {"type": "tool_use", "id": call["id"], "name": function["name"], "input": arguments}


def _to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    converted: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        blocks = _content_blocks(content, allow_images=role in ("user", "tool"))
        if role in ("system", "developer"):
            system_parts.extend(block["text"] for block in blocks)
            continue
        if role == "tool":
            if not message.get("tool_call_id"):
                raise _invalid("A tool result requires tool_call_id")
            blocks = [{
                "type": "tool_result",
                "tool_use_id": message["tool_call_id"],
                "content": content if isinstance(content, str) else blocks,
            }]
            role = "user"
        elif role == "assistant":
            calls = message.get("tool_calls")
            if calls is not None:
                if not isinstance(calls, list):
                    raise _invalid("tool_calls must be a list of function calls")
                blocks.extend(_tool_use(call) for call in calls)
        elif role != "user":
            raise _invalid("Unsupported Anthropic message role")
        # Keep plain messages as strings. Anthropic combines adjacent turns with
        # the same role, including consecutive results from parallel tool calls.
        if len(blocks) == 1 and blocks[0]["type"] == "text":
            converted.append({"role": role, "content": blocks[0]["text"]})
        else:
            converted.append({"role": role, "content": blocks})
    return "\n".join(system_parts), converted


def _tool_definition(tool: dict) -> dict:
    if not isinstance(tool, dict) or tool.get("type") != "function":
        raise _invalid("Anthropic supports function tools")
    function = tool.get("function")
    if not isinstance(function, dict) or not function.get("name"):
        raise _invalid("A function definition requires a name")
    definition = {
        "name": function["name"],
        "input_schema": function.get("parameters", {"type": "object", "properties": {}}),
    }
    for field in ("description", "strict"):
        if function.get(field) is not None:
            definition[field] = function[field]
    return definition


def _tool_choice(choice) -> dict:
    if choice in ("auto", "none"):
        return {"type": choice}
    if choice == "required":
        return {"type": "any"}
    if isinstance(choice, dict) and choice.get("type") == "function":
        function = choice.get("function")
        if isinstance(function, dict) and function.get("name"):
            return {"type": "tool", "name": function["name"]}
    raise _invalid("Unsupported Anthropic tool_choice")


def _apply_options(payload: dict, options: dict) -> None:
    supported = {
        "top_p", "stop", "max_completion_tokens", "tools", "tool_choice",
        "parallel_tool_calls", "response_format",
    }
    unsupported = options.keys() - supported
    if unsupported:
        raise _invalid("Unsupported Anthropic options: " + ", ".join(sorted(unsupported)))
    if "top_p" in options:
        payload["top_p"] = options["top_p"]
    if "stop" in options:
        stop = options["stop"]
        payload["stop_sequences"] = [stop] if isinstance(stop, str) else stop
    if "max_completion_tokens" in options:
        payload["max_tokens"] = options["max_completion_tokens"]
    if "tools" in options:
        payload["tools"] = [_tool_definition(tool) for tool in options["tools"]]
    if "tool_choice" in options or ("parallel_tool_calls" in options and payload.get("tools")):
        choice = _tool_choice(options.get("tool_choice", "auto"))
        if choice["type"] != "none" and "parallel_tool_calls" in options:
            choice["disable_parallel_tool_use"] = not options["parallel_tool_calls"]
        payload["tool_choice"] = choice
    response_format = options.get("response_format")
    if response_format is not None and response_format.get("type") != "text":
        if response_format.get("type") != "json_schema":
            raise _invalid("Anthropic structured output requires response_format.type=json_schema")
        definition = response_format.get("json_schema")
        schema = definition.get("schema") if isinstance(definition, dict) else None
        if not isinstance(schema, dict):
            raise _invalid("Anthropic structured output requires a JSON schema")
        payload["output_config"] = {"format": {"type": "json_schema", "schema": schema}}


async def _parse_anthropic(response: httpx.Response) -> AsyncIterator[ChatChunk]:
    # Anthropic indexes all content blocks, while OpenAI indexes only tool calls.
    tool_indices: dict[int, int] = {}
    empty_input: set[int] = set()
    saw_stop_reason = False
    async for _event, data in iter_sse_events(response):
        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            raise AdapterError(502, "Malformed Anthropic event", False) from exc
        if not isinstance(payload, dict):
            raise AdapterError(502, "Malformed Anthropic event", False)
        kind = payload.get("type")
        index = payload.get("index")
        if kind == "message_start":
            usage = (payload.get("message") or {}).get("usage") or {}
            yield ChatChunk(
                prompt_tokens=usage.get("input_tokens"),
                completion_tokens=usage.get("output_tokens"),
            )
        elif kind == "content_block_start":
            block = payload.get("content_block") or {}
            if block.get("type") == "tool_use":
                tool_indices[index] = len(tool_indices)
                arguments = json.dumps(block["input"]) if block.get("input") else ""
                if not arguments:
                    empty_input.add(index)
                yield ChatChunk(tool_calls=[{
                    "index": tool_indices[index],
                    "type": "function",
                    "id": block["id"],
                    "function": {"name": block["name"], "arguments": arguments},
                }])
            elif block.get("type") == "text" and block.get("text"):
                yield ChatChunk(content=block["text"])
        elif kind == "content_block_delta":
            delta = payload.get("delta") or {}
            if delta.get("type") == "text_delta":
                yield ChatChunk(content=delta.get("text") or "")
            elif delta.get("type") == "input_json_delta" and delta.get("partial_json"):
                empty_input.discard(index)
                yield ChatChunk(tool_calls=[{
                    "index": tool_indices[index], "function": {"arguments": delta["partial_json"]},
                }])
        elif kind == "content_block_stop" and index in empty_input:
            empty_input.remove(index)
            yield ChatChunk(tool_calls=[{"index": tool_indices[index], "function": {"arguments": "{}"}}])
        elif kind == "message_delta":
            usage = payload.get("usage") or {}
            stop = (payload.get("delta") or {}).get("stop_reason")
            saw_stop_reason = saw_stop_reason or bool(stop)
            reasons = {
                "tool_use": "tool_calls", "max_tokens": "length",
                "model_context_window_exceeded": "length", "refusal": "content_filter",
            }
            yield ChatChunk(
                completion_tokens=usage.get("output_tokens"),
                finish_reason=reasons.get(stop, "stop") if stop else None,
            )
        elif kind == "message_stop":
            if not saw_stop_reason:
                raise AdapterError(502, "Anthropic stream ended without a stop reason", False)
            return
        elif kind == "error":
            error = payload.get("error") or {}
            raise AdapterError(502, str(error.get("message") or "anthropic stream error"), False)
    raise AdapterError(502, "Anthropic stream ended before message_stop", False)
