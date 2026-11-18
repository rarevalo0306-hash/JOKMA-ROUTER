import json

import httpx
import pytest

from app.adapters.base import AdapterError
from app.adapters.ollama import OllamaAdapter


def _ndjson(*events):
    return "\n".join(json.dumps(event) for event in events).encode()


async def _chat(client, messages, **options):
    return await OllamaAdapter().open_chat(
        client,
        base_url="http://ollama.example/api",
        api_key=None,
        model="local-model",
        messages=messages,
        temperature=0,
        max_tokens=32,
        options=options,
        timeout=10,
    )


async def test_tool_calls_round_trip_with_parallel_tools_and_images():
    requests = []

    def handle(request):
        assert request.url.path == "/api/chat"
        requests.append(json.loads(request.content))
        if len(requests) > 1:
            return httpx.Response(200, content=_ndjson({
                "message": {"content": "Partly cloudy"}, "done": True,
            }))
        return httpx.Response(200, content=_ndjson(
            {"message": {"thinking": "Considering weather"}, "done": False},
            {"message": {"tool_calls": [{"function": {"name": "weather", "arguments": {"city": "Bogotá"}}}]}, "done": False},
            {"message": {"tool_calls": [{"id": "ollama-2", "function": {"name": "weather", "arguments": {"city": "Lima"}}}]}, "done": False},
            {"done": True, "done_reason": "stop", "prompt_eval_count": 8, "eval_count": 5},
        ))

    messages = [
        {"role": "developer", "content": "Use an available tool"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,YWJj"}},
            {"type": "text", "text": "Compare weather"},
        ]},
    ]
    tools = [{"type": "function", "function": {"name": "weather", "parameters": {"type": "object"}}}]
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        stream = await _chat(client, messages, tools=tools, tool_choice="auto", reasoning_effort="low")
        thinking, first, second, final = [chunk async for chunk in stream]
        assert thinking.reasoning_content == "Considering weather"
        assert final.finish_reason == "tool_calls"
        assert (final.prompt_tokens, final.completion_tokens) == (8, 5)
        first_call, second_call = first.tool_calls[0].copy(), second.tool_calls[0].copy()
        assert (first_call.pop("index"), second_call.pop("index")) == (0, 1)
        assert first_call["id"].startswith("call_")
        assert second_call["id"] == "ollama-2"
        assert json.loads(first_call["function"]["arguments"]) == {"city": "Bogotá"}
        assert first_call["type"] == "function"

        messages.append({"role": "assistant", "content": None, "tool_calls": [first_call, second_call]})
        for call in (second_call, first_call):
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": "Sunny"})
        stream = await _chat(client, messages, tools=tools, tool_choice="none")
        assert [chunk.content async for chunk in stream] == ["Partly cloudy"]

    assert requests[0]["messages"] == [
        {"role": "system", "content": "Use an available tool"},
        {"role": "user", "content": "Compare weather", "images": ["YWJj"]},
    ]
    assert requests[0]["tools"] == tools
    assert requests[0]["think"] == "low"
    assert "tools" not in requests[1]
    history = requests[1]["messages"]
    assert history[-3]["tool_calls"][0]["function"]["arguments"] == {"city": "Bogotá"}
    assert history[-2] == {"role": "tool", "content": "Sunny", "tool_name": "weather", "tool_call_id": "ollama-2"}


async def test_json_schema_and_sampling_controls():
    schema = {"type": "object", "properties": {"answer": {"type": "number"}}}

    def handle(request):
        body = json.loads(request.content)
        assert body["format"] == schema
        assert body["options"] == {"num_predict": 16, "temperature": 0, "seed": 1, "stop": ["end"]}
        return httpx.Response(200, content=_ndjson({"message": {"content": '{"answer":4}'}, "done": True, "done_reason": "length"}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        stream = await _chat(
            client, [{"role": "user", "content": "2+2"}], max_completion_tokens=16, seed=1, stop="end",
            response_format={"type": "json_schema", "json_schema": {"name": "result", "schema": schema}},
        )
        chunk, = [chunk async for chunk in stream]
        assert json.loads(chunk.content) == {"answer": 4}
        assert chunk.finish_reason == "length"


@pytest.mark.parametrize(("messages", "options"), [
    ([{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://example.com/a.jpg"}}]}], {}),
    ([{"role": "tool", "tool_call_id": "unknown", "content": "abc"}], {}),
    ([{"role": "user", "content": "hello"}], {"tool_choice": "required"}),
    ([{"role": "user", "content": "hello"}], {"response_format": {"type": "json_schema"}}),
    ([{"role": "user", "content": "hello"}], {"modalities": ["audio"]}),
])
async def test_unsupported_input_fails_before_contacting_ollama(messages, options):
    def unexpected(_):
        pytest.fail("the provider must not be contacted")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected)) as client:
        with pytest.raises(AdapterError) as raised:
            await _chat(client, messages, **options)
        assert raised.value.status_code == 400
        assert not raised.value.retryable


async def test_missing_done_is_reported_as_incomplete_after_first_delta():
    def handle(_):
        return httpx.Response(200, content=_ndjson({"message": {"content": "partial"}, "done": False}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        stream = await _chat(client, [{"role": "user", "content": "hello"}])
        chunks = stream.__aiter__()
        assert (await anext(chunks)).content == "partial"
        with pytest.raises(AdapterError, match="before its final message") as raised:
            await anext(chunks)
        assert raised.value.status_code == 502
        assert stream.response.is_closed


async def test_malformed_tool_arguments_are_rejected_before_contacting_ollama():
    call = {"id": "call_test", "type": "function", "function": {"name": "test", "arguments": "{bad"}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail())) as client:
        with pytest.raises(AdapterError, match="Tool arguments") as raised:
            await _chat(client, [{"role": "assistant", "content": None, "tool_calls": [call]}])
        assert raised.value.status_code == 400
