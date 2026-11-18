import json

import httpx
import pytest

from tests.conftest import create_key, create_model, create_provider, install_mock
from tests.test_gateway import ollama_body, openai_sse


FUNCTION = {
    "type": "function",
    "function": {
        "name": "price",
        "parameters": {
            "type": "object",
            "properties": {"sku": {"type": "string"}},
            "required": ["sku"],
        },
    },
}
SCHEMA = {
    "type": "object",
    "properties": {"price": {"type": "number"}},
    "required": ["price"],
    "additionalProperties": False,
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "quote", "schema": SCHEMA},
}
IMAGE = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+jWZkAAAAASUVORK5CYII="
)
PHOTO = {
    "role": "user",
    "content": [
        {"type": "text", "text": "Quote the item in this photo."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{IMAGE}"}},
    ],
}


async def register_local(client):
    provider = await create_provider(
        client, name="office", adapter="ollama", base_url="http://office:11434", api_key=None
    )
    return await create_model(client, provider["id"], name="gemma3:4b")


async def test_one_gateway_key_keeps_multimodal_json_request_on_local_fallback(app, client):
    backup = await register_local(client)
    cloud = await create_provider(client, api_key="sk-cloud-only")
    await create_model(client, cloud["id"], alias="quote", fallback_model_ids=[backup["id"]])
    key = await create_key(client)
    headers = {"Authorization": f"Bearer {key['raw_key']}"}
    models = await client.get("/v1/models", headers=headers)
    assert models.status_code == 200
    assert {item["id"] for item in models.json()["data"]} == {
        "openai/gpt-4o", "office/gemma3:4b", "quote",
    }

    cloud_requests = 0
    local_requests = 0

    async def provider(request):
        nonlocal cloud_requests, local_requests
        body = json.loads(request.content)
        if request.url.host == "api.openai.com":
            cloud_requests += 1
            assert request.headers["authorization"] == "Bearer sk-cloud-only"
            assert body["model"] == "gpt-4o"
            assert body["messages"] == [PHOTO]
            assert body["response_format"] == RESPONSE_FORMAT
            if cloud_requests == 1:
                return httpx.Response(200, content=openai_sse('{"price":5}'))
            return httpx.Response(429, json={"error": {"message": "rate limit"}})
        local_requests += 1
        assert str(request.url) == "http://office:11434/api/chat"
        assert "authorization" not in request.headers
        assert body["model"] == "gemma3:4b"
        assert body["messages"][0]["content"] == PHOTO["content"][0]["text"]
        assert body["messages"][0]["images"] == [IMAGE]
        assert body["format"] == SCHEMA
        return httpx.Response(200, content=ollama_body('{"price":4}', counts=True))

    await install_mock(app, provider)
    for model, served, fallback, price in [
        ("quote", "openai/gpt-4o", "false", 5),
        ("quote", "office/gemma3:4b", "true", 4),
        ("office/gemma3:4b", "office/gemma3:4b", "false", 4),
    ]:
        result = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": model, "messages": [PHOTO], "response_format": RESPONSE_FORMAT},
        )
        assert result.status_code == 200, result.text
        assert result.headers["x-jokma-model-served"] == served
        assert result.headers["x-jokma-fallback"] == fallback
        assert json.loads(result.json()["choices"][0]["message"]["content"]) == {"price": price}
    assert (cloud_requests, local_requests) == (2, 2)


def tool_stream():
    """Two overlapping calls with argument fragments arriving in a different order."""
    chunks = [
        {"delta": {"tool_calls": [
            {"index": i, "id": f"call_{i}", "type": "function",
             "function": {"name": "price", "arguments": '{"sku":"'}}
            for i in range(2)
        ]}},
        {"delta": {"tool_calls": [
            {"index": 1, "function": {"arguments": 'B"}'}},
            {"index": 0, "function": {"arguments": 'A"}'}},
        ]}},
        {"delta": {}, "finish_reason": "tool_calls"},
    ]
    events = [json.dumps({"choices": [{"index": 0, **chunk}]}) for chunk in chunks]
    return "".join(f"data: {event}\n\n" for event in [*events, "[DONE]"]).encode()


@pytest.mark.parametrize("stream", [False, True])
async def test_parallel_tool_calls_round_trip_through_chat_api(app, client, stream):
    cloud = await create_provider(client)
    await create_model(client, cloud["id"], alias="ordering")
    key = await create_key(client)
    headers = {"Authorization": f"Bearer {key['raw_key']}"}
    history = [{"role": "user", "content": "Compare prices for items A and B."}]
    request_options = {"model": "ordering", "tools": [FUNCTION], "tool_choice": "auto"}
    captured = []

    async def provider(request):
        body = json.loads(request.content)
        captured.append(body)
        if len(captured) == 1:
            return httpx.Response(200, content=tool_stream())
        return httpx.Response(200, content=openai_sse("Both cost the same."))

    await install_mock(app, provider)
    result = await client.post(
        "/v1/chat/completions",
        headers=headers,
        json={**request_options, "messages": history, "stream": stream},
    )
    assert result.status_code == 200, result.text
    assert captured[0]["tools"] == [FUNCTION]
    assert captured[0]["tool_choice"] == "auto"
    if stream:
        events = [line[6:] for line in result.text.splitlines() if line.startswith("data: ")]
        assert events.pop() == "[DONE]"
        choices = [choice for event in events for choice in json.loads(event)["choices"]]
        assert choices[0]["delta"]["role"] == "assistant"
        assert choices[-1]["finish_reason"] == "tool_calls"
        calls = {}
        for choice in choices:
            for delta in choice["delta"].get("tool_calls", []):
                call = calls.setdefault(delta["index"], {"function": {"name": "", "arguments": ""}})
                for field in ("id", "type"):
                    if field in delta:
                        call[field] = delta[field]
                for field in ("name", "arguments"):
                    call["function"][field] += delta.get("function", {}).get(field, "")
        message = {"role": "assistant", "content": None, "tool_calls": [calls[0], calls[1]]}
    else:
        choice = result.json()["choices"][0]
        assert choice["finish_reason"] == "tool_calls"
        message = choice["message"]
    assert message["role"] == "assistant"
    assert message["tool_calls"] == [
        {"id": f"call_{i}", "type": "function",
         "function": {"name": "price", "arguments": json.dumps({"sku": sku}, separators=(",", ":"))}}
        for i, sku in enumerate(("A", "B"))
    ]

    history.append(message)
    history.extend(
        {"role": "tool", "tool_call_id": call["id"], "content": "10"}
        for call in message["tool_calls"]
    )
    result = await client.post(
        "/v1/chat/completions", headers=headers, json={**request_options, "messages": history}
    )
    assert result.status_code == 200, result.text
    assert captured[1]["messages"] == history
    assert result.json()["choices"][0]["message"]["content"] == "Both cost the same."


async def test_local_model_rejects_unsupported_choice_before_sending_request(app, client):
    model = await register_local(client)
    key = await create_key(client)

    async def unexpected_request(request):
        pytest.fail(f"Unsupported request reached {request.url}")

    await install_mock(app, unexpected_request)
    response = await client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {key['raw_key']}"},
        json={
            "model": model["public_id"],
            "messages": [{"role": "user", "content": "Hello"}],
            "n": 2,
        },
    )
    assert response.status_code in {400, 422}
    assert response.json()["error"]["message"]
