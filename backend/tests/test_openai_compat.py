import json

import httpx
import pytest

from app.adapters import AdapterError, get_adapter


def event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@pytest.mark.parametrize("slug", ["openai", "gemini", "vllm", "together", "deepseek", "groq"])
async def test_compatible_models_keep_rich_messages_and_options(slug):
    messages = [
        {"role": "developer", "content": "Use the tools."},
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://example.com/img.png"}}]},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_A", "type": "function", "function": {"name": "lookup", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "call_A", "content": "blanco"},
    ]
    options = {
        "tools": [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "result", "schema": {"type": "object"}}},
        "parallel_tool_calls": True,
        "max_completion_tokens": 500,
    }
    seen = {}
    tool = {"index": 0, "type": "function", "id": "call_B", "function": {"name": "lookup", "arguments": ""}}
    fragment = {"index": 0, "function": {"arguments": "{}"}}

    def handler(request):
        seen["body"] = json.loads(request.content)
        assert request.headers["authorization"] == "Bearer test-provider-key"
        return httpx.Response(200, content=(
            event({"choices": [{"delta": {"tool_calls": [tool]}}]})
            + event({"choices": [{"delta": {"tool_calls": [fragment]}, "finish_reason": "tool_calls"}]})
            + event({"choices": [], "usage": {"prompt_tokens": 14, "completion_tokens": 3}})
            + "data: [DONE]\n\n"
        ))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        stream = await get_adapter(slug).open_chat(
            client, base_url="https://models.example/v1", api_key="test-provider-key",
            model="agent/llama", messages=messages, options=options, temperature=None, max_tokens=None, timeout=5,
        )
        chunks = [chunk async for chunk in stream]
    assert seen["body"] == {**options, "messages": messages, "model": "agent/llama",
                            "stream": True, "stream_options": {"include_usage": True}}
    assert chunks[0].tool_calls == [tool]
    assert chunks[1].tool_calls == [fragment]
    assert chunks[1].finish_reason == "tool_calls"
    assert chunks[2].prompt_tokens == 14


@pytest.mark.parametrize("options", [{"functions": []}, {"modalities": ["audio"]}, {"logprobs": True}])
async def test_unrepresentable_output_options_rejected_before_call(options):
    async with httpx.AsyncClient() as client:
        with pytest.raises(AdapterError) as error:
            await get_adapter("openai").open_chat(
                client, base_url="https://unused.invalid", api_key=None, model="example",
                messages=[], temperature=None, max_tokens=None, options=options, timeout=5,
            )
    assert error.value.status_code == 400


async def test_reasoning_and_refusal_fragments_are_distinct_from_text():
    from app.adapters.openai_compat import _parse_openai

    sse = (event({"choices": [{"delta": {"reasoning_content": "consider"}}]})
           + event({"choices": [{"delta": {"refusal": "blocked"}, "finish_reason": "stop"}]})
           + "data: [DONE]\n\n")
    chunks = [chunk async for chunk in _parse_openai(httpx.Response(200, content=sse))]
    assert chunks[0].reasoning_content == "consider"
    assert chunks[1].refusal == "blocked"
    assert not chunks[1].content


@pytest.mark.parametrize("sse", [
    event({"error": {"message": "failure"}}),
    "data: [DONE]\n\n",
    event({"choices": [{"delta": {"content": "unfinished"}}]}),
])
async def test_invalid_or_interrupted_stream_fails(sse):
    from app.adapters.openai_compat import _parse_openai

    with pytest.raises(AdapterError) as error:
        async for _ in _parse_openai(httpx.Response(200, content=sse)):
            pass
    assert error.value.status_code == 502
