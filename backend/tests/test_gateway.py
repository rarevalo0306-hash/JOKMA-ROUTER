import asyncio
import json
import sqlite3
import time

import httpx
import pytest
import respx

from tests.conftest import ADMIN, create_key, create_model, create_provider, install_mock


def openai_sse(text: str, usage: dict | None = None) -> bytes:
    chunk = {
        "id": "chatcmpl-upstream",
        "object": "chat.completion.chunk",
        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
    }
    parts = [f"data: {json.dumps(chunk)}\n\n"]
    if usage is not None:
        done = {
            "id": "chatcmpl-upstream",
            "object": "chat.completion.chunk",
            "choices": [],
            "usage": usage,
        }
        parts.append(f"data: {json.dumps(done)}\n\n")
    parts.append("data: [DONE]\n\n")
    return "".join(parts).encode()


def anthropic_sse(text: str) -> bytes:
    events = [
        (
            "message_start",
            {
                "type": "message_start",
                "message": {"usage": {"input_tokens": 11, "output_tokens": 1}},
            },
        ),
        (
            "content_block_delta",
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
        ),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 4},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    ]
    raw = ""
    for name, payload in events:
        raw += f"event: {name}\ndata: {json.dumps(payload)}\n\n"
    return raw.encode()


def ollama_body(text: str, *, counts: bool) -> bytes:
    if counts:
        lines = [
            {"message": {"role": "assistant", "content": text}, "done": False},
            {
                "message": {"role": "assistant", "content": ""},
                "done": True,
                "prompt_eval_count": 9,
                "eval_count": 3,
            },
        ]
    else:
        lines = [{"message": {"role": "assistant", "content": text}, "done": True}]
    return ("\n".join(json.dumps(line) for line in lines) + "\n").encode()


def chat(model: str, content: str = "hello world!!", stream: bool = True) -> dict:
    return {
        "model": model,
        "stream": stream,
        "messages": [{"role": "user", "content": content}],
    }


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_missing_and_invalid_keys_are_rejected(client):
    missing = await client.post("/v1/chat/completions", json=chat("openai/gpt-4o"))
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "invalid_api_key"

    foreign = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o"),
        headers={"Authorization": "Bearer sk-not-ours"},
    )
    assert foreign.status_code == 401
    assert foreign.json()["error"]["code"] == "invalid_api_key"


async def test_api_key_needs_only_a_name_and_the_list_stays_masked(client):
    created = []
    for name in ("Producción", "Facturas", "Otro"):
        response = await client.post("/admin/api-keys", json={"name": name}, headers=ADMIN)
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["name"] == name
        assert body["app_name"] == name
        assert body["raw_key"].startswith("ak_")
        assert len(body["raw_key"]) > len(body["key_prefix"])
        created.append(body)
    listed = await client.get("/admin/api-keys", headers=ADMIN)
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) >= 3
    for row in rows:
        assert "raw_key" not in row
    text = listed.text
    for body in created:
        assert body["raw_key"] not in text
        assert body["key_prefix"] in text


async def test_revoked_key_is_rejected(client):
    created = await create_key(client)
    revoked = await client.post(f"/admin/api-keys/{created['id']}/revoke", headers=ADMIN)
    assert revoked.status_code == 200
    response = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o"),
        headers={"Authorization": f"Bearer {created['raw_key']}"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "revoked_api_key"


async def test_models_list_includes_alias_and_hides_disabled(client):
    provider = await create_provider(client)
    await create_model(client, provider["id"], alias="smart")
    await create_model(
        client,
        provider["id"],
        name="gpt-4o-mini",
        alias="hidden",
        enabled=False,
    )
    key = await create_key(client)
    response = await client.get(
        "/v1/models",
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["data"]]
    assert ids == ["openai/gpt-4o", "smart"]


async def test_openai_streaming_forwards_tokens_and_usage(app, client):
    provider = await create_provider(client)
    await create_model(
        client,
        provider["id"],
        input_per_million=3,
        output_per_million=6,
    )
    key = await create_key(client, app_name="facturas")
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            content=openai_sse("hola", {"prompt_tokens": 1000, "completion_tokens": 500}),
        )

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o"),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 200
    assert "hola" in response.text
    assert "data: [DONE]" in response.text
    assert response.headers["x-jokma-fallback"] == "false"
    assert response.headers["x-jokma-model-served"] == "openai/gpt-4o"
    assert seen["url"] == "https://api.openai.com/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["body"]["model"] == "gpt-4o"
    assert seen["body"]["stream"] is True

    summary = await client.get("/admin/usage/summary", headers=ADMIN)
    assert summary.status_code == 200
    body = summary.json()
    assert body["requests"] == 1
    assert body["tokens_by_app"] == [
        {"app": "facturas", "prompt_tokens": 1000, "completion_tokens": 500, "requests": 1}
    ]
    assert body["cost_by_model"][0]["model"] == "openai/gpt-4o"
    assert body["cost_by_model"][0]["estimated_cost"] == pytest.approx(0.006)
    assert body["avg_latency_ms"] is not None
    recent = body["recent"][0]
    assert recent["status"] == "success"
    assert recent["model_requested"] == "openai/gpt-4o"
    assert recent["model_served"] == "openai/gpt-4o"
    assert recent["prompt_tokens"] == 1000
    assert recent["completion_tokens"] == 500


async def test_openai_stream_is_not_buffered():
    """The adapter yields the first SSE event before the rest of the body arrives.

    httpx's ASGI transport buffers a whole StreamingResponse, so this talks to
    the adapter directly with an httpx mock stream.
    """
    from app.adapters.openai_compat import OpenAIAdapter

    async def handler(_request: httpx.Request) -> httpx.Response:
        class SlowStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                payload = {"choices": [{"index": 0, "delta": {"content": "hola"}}]}
                yield f"data: {json.dumps(payload)}\n\n".encode()
                await asyncio.sleep(1.2)
                yield b"data: [DONE]\n\n"

        return httpx.Response(200, stream=SlowStream())

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    started = time.perf_counter()
    opened = await OpenAIAdapter().open_chat(
        http,
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model="gpt-4o",
        messages=[{"role": "user", "content": "hi"}],
        temperature=None,
        max_tokens=None,
        timeout=5,
    )
    iterator = opened.__aiter__()
    try:
        first = await iterator.__anext__()
        elapsed = time.perf_counter() - started
    finally:
        await iterator.aclose()
        await http.aclose()
    assert first.content == "hola"
    assert elapsed < 0.7


async def test_anthropic_stream_is_translated(app, client):
    provider = await create_provider(
        client,
        name="anthropic",
        adapter="anthropic",
        base_url="https://api.anthropic.com",
        api_key="sk-ant-test",
    )
    await create_model(client, provider["id"], name="claude-3-5-sonnet", alias="writer")
    key = await create_key(client)
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers["x-api-key"]
        seen["version"] = request.headers["anthropic-version"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=anthropic_sse("desde-anthropic"))

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json={
            "model": "writer",
            "stream": True,
            "messages": [
                {"role": "system", "content": "sé breve"},
                {"role": "user", "content": "hola"},
            ],
        },
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 200, response.text
    assert "desde-anthropic" in response.text
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["key"] == "sk-ant-test"
    assert seen["version"] == "2023-06-01"
    assert seen["body"]["model"] == "claude-3-5-sonnet"
    assert seen["body"]["system"] == "sé breve"
    assert seen["body"]["messages"] == [{"role": "user", "content": "hola"}]
    summary = (await client.get("/admin/usage/summary", headers=ADMIN)).json()
    recent = summary["recent"][0]
    assert recent["model_requested"] == "writer"
    assert recent["model_served"] == "anthropic/claude-3-5-sonnet"
    assert recent["prompt_tokens"] == 11
    assert recent["completion_tokens"] == 4


async def test_ollama_estimates_tokens_when_provider_omits_them(app, client):
    provider = await create_provider(
        client,
        name="local",
        adapter="ollama",
        base_url="http://127.0.0.1:11434",
        api_key=None,
    )
    await create_model(client, provider["id"], name="llama3.2-3b", alias="local-llama")
    key = await create_key(client)
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["url"] = str(request.url)
        return httpx.Response(200, content=ollama_body("abcd", counts=False))

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("local/llama3.2-3b", stream=False),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["choices"][0]["message"]["content"] == "abcd"
    assert body["object"] == "chat.completion"
    assert seen["url"] == "http://127.0.0.1:11434/api/chat"
    assert seen["body"]["model"] == "llama3.2-3b"
    assert seen["body"]["stream"] is True
    summary = (await client.get("/admin/usage/summary", headers=ADMIN)).json()
    recent = summary["recent"][0]
    # "hello world!!" -> 4 tokens, role "user" -> 1, completion "abcd" -> 1.
    assert recent["prompt_tokens"] == 5
    assert recent["completion_tokens"] == 1
    assert recent["status"] == "success"


async def test_fallback_on_429_and_timeout(app, client):
    openai = await create_provider(client)
    local = await create_provider(
        client,
        name="local",
        adapter="ollama",
        base_url="http://127.0.0.1:11434",
        api_key=None,
    )
    primary = await create_model(client, openai["id"], alias="smart")
    secondary = await create_model(client, local["id"], name="llama3.2-3b")
    patched = await client.patch(
        f"/admin/models/{primary['id']}",
        json={"fallback_model_ids": [secondary["id"]]},
        headers=ADMIN,
    )
    assert patched.status_code == 200, patched.text
    key = await create_key(client)

    async def rate_limited(request: httpx.Request) -> httpx.Response:
        if "api.openai.com" in str(request.url):
            return httpx.Response(429, json={"error": {"message": "rate limit"}})
        return httpx.Response(200, content=ollama_body("desde-respaldo", counts=True))

    await install_mock(app, rate_limited)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("smart"),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 200, response.text
    assert "desde-respaldo" in response.text
    assert response.headers["x-jokma-model-served"] == "local/llama3.2-3b"
    assert response.headers["x-jokma-fallback"] == "true"
    summary = (await client.get("/admin/usage/summary", headers=ADMIN)).json()
    recent = summary["recent"][0]
    assert recent["status"] == "fallback"
    assert recent["model_requested"] == "smart"
    assert recent["model_served"] == "local/llama3.2-3b"
    assert recent["prompt_tokens"] == 9
    assert recent["completion_tokens"] == 3
    assert [item["status"] for item in recent["route_trace"]] == [429, 200]

    async def timed_out(request: httpx.Request) -> httpx.Response:
        if "api.openai.com" in str(request.url):
            raise httpx.ConnectTimeout("timed out")
        return httpx.Response(200, content=ollama_body("tras-timeout", counts=True))

    await install_mock(app, timed_out)
    second = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o"),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert second.status_code == 200, second.text
    assert "tras-timeout" in second.text
    assert second.headers["x-jokma-fallback"] == "true"


async def test_client_error_does_not_fallback(app, client):
    openai = await create_provider(client)
    local = await create_provider(
        client,
        name="local",
        adapter="ollama",
        base_url="http://127.0.0.1:11434",
        api_key=None,
    )
    primary = await create_model(client, openai["id"])
    secondary = await create_model(client, local["id"], name="llama3.2-3b")
    await client.patch(
        f"/admin/models/{primary['id']}",
        json={"fallback_model_ids": [secondary["id"]]},
        headers=ADMIN,
    )
    key = await create_key(client)
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(400, json={"error": {"message": "bad request"}})

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o"),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 400
    assert calls == ["https://api.openai.com/v1/chat/completions"]
    summary = (await client.get("/admin/usage/summary", headers=ADMIN)).json()
    assert summary["recent"][0]["status"] == "error"
    assert summary["recent"][0]["model_served"] is None


async def test_stub_adapter_is_not_called_upstream(app, client):
    provider = await create_provider(
        client,
        name="groq",
        adapter="groq",
        base_url="https://api.groq.com/openai/v1",
        api_key="gsk-test",
    )
    await create_model(client, provider["id"], name="llama-3.3-70b")
    key = await create_key(client)
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=openai_sse("no"))

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("groq/llama-3.3-70b", stream=False),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 501
    assert calls == []
    assert "not implemented" in response.json()["error"]["message"]


async def test_video_provider_is_not_a_chat_route(app, client):
    provider = await create_provider(
        client,
        name="sora",
        adapter="video",
        base_url="https://platform.openai.com/api-keys",
        api_key="video-placeholder",
        enabled=True,
    )
    await create_model(client, provider["id"], name="sora-2", alias=None)
    key = await create_key(client)
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"{}")

    await install_mock(app, handler)
    response = await client.post(
        "/v1/chat/completions",
        json=chat("sora/sora-2", stream=False),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert response.status_code == 404
    assert calls == []
    listed = await client.get("/v1/models", headers={"Authorization": f"Bearer {key['raw_key']}"})
    assert listed.status_code == 200
    assert all(item["id"] != "sora/sora-2" for item in listed.json()["data"])


async def test_respx_openai_non_stream_shape(app, client):
    """respx covers the same OpenAI path as the httpx mock transport."""
    provider = await create_provider(client, api_key="sk-respx")
    await create_model(client, provider["id"], name="gpt-4o-mini", alias=None)
    key = await create_key(client)
    payload = openai_sse("via-respx", {"prompt_tokens": 2, "completion_tokens": 1})
    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.openai.com/v1/chat/completions").mock(
            return_value=httpx.Response(200, content=payload)
        )
        response = await client.post(
            "/v1/chat/completions",
            json=chat("openai/gpt-4o-mini", stream=False),
            headers={"Authorization": f"Bearer {key['raw_key']}"},
        )
    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"] == "via-respx"


async def test_openrouter_sends_the_full_model_id(app, client):
    openai = await create_provider(client)
    await create_model(client, openai["id"], name="gpt-4o", alias=None)
    router = await create_provider(
        client,
        name="openrouter",
        adapter="openai",
        base_url="https://openrouter.ai/api/v1",
        api_key="or-test",
    )
    created = await create_model(client, router["id"], name="openai/gpt-4o", alias=None)
    assert created["public_id"] == "openrouter/openai/gpt-4o"
    key = await create_key(client)
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["model"] = json.loads(request.content)["model"]
        return httpx.Response(200, content=openai_sse("via-router", {"prompt_tokens": 1, "completion_tokens": 1}))

    await install_mock(app, handler)
    routed = await client.post(
        "/v1/chat/completions",
        json=chat("openrouter/openai/gpt-4o", stream=False),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert routed.status_code == 200, routed.text
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["model"] == "openai/gpt-4o"

    direct = await client.post(
        "/v1/chat/completions",
        json=chat("openai/gpt-4o", stream=False),
        headers={"Authorization": f"Bearer {key['raw_key']}"},
    )
    assert direct.status_code == 200, direct.text
    assert seen["url"] == "https://api.openai.com/v1/chat/completions"
    assert seen["model"] == "gpt-4o"
    listed = await client.get("/v1/models", headers={"Authorization": f"Bearer {key['raw_key']}"})
    ids = {item["id"] for item in listed.json()["data"]}
    assert "openrouter/openai/gpt-4o" in ids
    assert "openai/gpt-4o" in ids


async def test_provider_secret_is_encrypted_at_rest(app, client):
    created = await create_provider(client, api_key="sk-super-secret")
    assert created["api_key_last4"] == "cret"
    assert created["has_api_key"] is True
    assert "sk-super-secret" not in json.dumps(created)

    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        return httpx.Response(200, json={"data": [{"id": "gpt-4o"}]})

    await install_mock(app, handler)
    tested = await client.post(f"/admin/providers/{created['id']}/test", headers=ADMIN)
    assert tested.status_code == 200, tested.text
    assert tested.json()["ok"] is True
    assert seen["auth"] == "Bearer sk-super-secret"

    path = app.state.settings.database_url.removeprefix("sqlite+aiosqlite:///")
    stored = sqlite3.connect(path).execute("select api_key_encrypted from providers").fetchone()[0]
    assert stored
    assert "sk-super-secret" not in stored

    key = await create_key(client)
    listed = await client.get("/admin/api-keys", headers=ADMIN)
    assert listed.status_code == 200
    assert "raw_key" not in listed.json()[0]
    assert key["raw_key"] not in listed.text
    hashes = sqlite3.connect(path).execute("select key_hash from api_keys").fetchall()
    assert all(key["raw_key"] not in row[0] for row in hashes)
    assert all(len(row[0]) == 64 for row in hashes)
