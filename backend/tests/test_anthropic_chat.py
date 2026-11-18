import json

import httpx
import pytest

from app.adapters.anthropic import AnthropicAdapter
from app.adapters.base import AdapterError


def _events(*events):
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events)


async def test_native_messages_translate_images_tools_and_structured_output():
    url = "https://example.org/photo.jpg"
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    function = {"name": "weather", "parameters": schema, "strict": True}
    messages = [
        {"role": "developer", "content": "Use the photo."},
        {"role": "user", "content": [
            {"type": "text", "text": "What is it?"},
            {"type": "image_url", "image_url": {"url": url}},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,YWJj"}},
        ]},
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": "call_1", "type": "function", "function": {"name": "weather", "arguments": "{}"},
        }]},
        {"role": "tool", "content": "Cloudy", "tool_call_id": "call_1"},
    ]
    options = {
        "tools": [{"type": "function", "function": function}],
        "tool_choice": {"type": "function", "function": {"name": "weather"}},
        "parallel_tool_calls": False,
        "response_format": {"type": "json_schema", "json_schema": {"name": "result", "schema": schema}},
        "stop": "END",
        "top_p": 0.9,
        "max_completion_tokens": 700,
    }
    def handler(request):
        body = json.loads(request.content)
        assert body["system"] == "Use the photo."
        assert body["messages"][0]["content"] == [
            {"type": "text", "text": "What is it?"},
            {"type": "image", "source": {"type": "url", "url": url}},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "YWJj"}},
        ]
        assert body["messages"][1:] == [
            {"role": "assistant", "content": [{"type": "tool_use", "id": "call_1", "name": "weather", "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "Cloudy"}]},
        ]
        assert body["tools"] == [{"name": "weather", "input_schema": schema, "strict": True}]
        assert body["tool_choice"] == {"type": "tool", "name": "weather", "disable_parallel_tool_use": True}
        assert body["output_config"]["format"] == {"type": "json_schema", "schema": schema}
        assert body["stop_sequences"] == ["END"]
        assert body["max_tokens"] == 700
        assert body["top_p"] == 0.9
        return httpx.Response(200, text=_events(
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Ok"}},
            {"type": "content_block_start", "index": 1, "content_block": {
                "type": "tool_use", "id": "call_2", "name": "weather", "input": {},
            }},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"city":'}},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '"Lima"}'}},
            {"type": "content_block_stop", "index": 1},
            {"type": "content_block_start", "index": 2, "content_block": {
                "type": "tool_use", "id": "call_3", "name": "now", "input": {},
            }},
            {"type": "content_block_stop", "index": 2},
            {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 9}},
            {"type": "message_stop"},
        ))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        stream = await AnthropicAdapter().open_chat(http, base_url="https://api.anthropic.com",
            api_key="fake", model="claude", messages=messages, temperature=None,
            max_tokens=None, timeout=5, options=options)
        chunks = [chunk async for chunk in stream]
    assert chunks[0].content == "Ok"
    calls = [call for chunk in chunks for call in chunk.tool_calls or []]
    assert [call["index"] for call in calls] == [0, 0, 0, 1, 1]
    assert [(call["id"], call["function"]["name"]) for call in calls if "id" in call] == [
        ("call_2", "weather"), ("call_3", "now"),
    ]
    assert [call["function"]["arguments"] for call in calls] == ["", '{"city":', '"Lima"}', "", "{}"]
    assert chunks[-1].completion_tokens == 9
    assert chunks[-1].finish_reason == "tool_calls"


@pytest.mark.parametrize(("options", "message"), [
    ({"response_format": {"type": "json_object"}}, "json_schema"),
    ({"frequency_penalty": 1}, "frequency_penalty"),
])
async def test_unsupported_options_are_rejected_before_contacting_anthropic(options, message):
    async with httpx.AsyncClient() as http:
        with pytest.raises(AdapterError, match=message) as error:
            await AnthropicAdapter().open_chat(http, base_url="https://api.anthropic.com", api_key="fake",
                model="claude", messages=[{"role": "user", "content": "Hi"}], options=options,
                temperature=None, max_tokens=None, timeout=5)
    assert error.value.status_code == 400


async def test_tool_round_trip_through_public_gateway(app, client):
    from tests.conftest import create_key, create_model, create_provider, install_mock

    provider = await create_provider(client, name="anthropic", adapter="anthropic",
                                     base_url="https://example.test")
    await create_model(client, provider["id"], name="claude", alias="asistente")
    key = await create_key(client)
    headers = {"Authorization": f"Bearer {key['raw_key']}"}
    function = {"type": "function", "function": {"name": "clock", "parameters": {"type": "object"}}}

    def handler(request):
        messages = json.loads(request.content)["messages"]
        if len(messages) == 1:
            return httpx.Response(200, text=_events(
                {"type": "content_block_start", "index": 0, "content_block": {
                    "type": "tool_use", "id": "call1", "name": "clock", "input": {},
                }},
                {"type": "content_block_stop", "index": 0},
                {"type": "message_delta", "delta": {"stop_reason": "tool_use"}},
                {"type": "message_stop"},
            ))
        assert messages[-2]["content"] == [{"type": "tool_use", "id": "call1", "name": "clock", "input": {}}]
        assert messages[-1]["content"] == [{"type": "tool_result", "tool_use_id": "call1", "content": "6pm"}]
        return httpx.Response(200, text=_events(
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "6pm"}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
            {"type": "message_stop"},
        ))

    await install_mock(app, handler)
    body = {"model": "asistente", "messages": [{"role": "user", "content": "Time?"}], "tools": [function]}
    first = await client.post("/v1/chat/completions", json=body, headers=headers)
    assert first.status_code == 200, first.text
    choice = first.json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"] == [
        {"type": "function", "id": "call1", "function": {"name": "clock", "arguments": "{}"}},
    ]
    body["messages"].extend([choice["message"], {"role": "tool", "tool_call_id": "call1", "content": "6pm"}])
    second = await client.post("/v1/chat/completions", json=body, headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["choices"][0]["message"]["content"] == "6pm"


@pytest.mark.parametrize("tail", [
    'data: broken-json\n\n',
    _events({"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
    _events({"type": "message_stop"}),
])
async def test_malformed_or_incomplete_stream_fails_even_after_text(tail):
    partial = _events({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "partial"}})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=partial + tail))
    async with httpx.AsyncClient(transport=transport) as http:
        stream = await AnthropicAdapter().open_chat(
            http, base_url="https://example.test", api_key="fake", model="claude",
            messages=[{"role": "user", "content": "Hi"}], temperature=None, max_tokens=None, timeout=5,
        )
        with pytest.raises(AdapterError) as error:
            _ = [chunk async for chunk in stream]
        assert error.value.status_code == 502
