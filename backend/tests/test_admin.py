from tests.conftest import ADMIN, create_model, create_provider


async def test_admin_requires_the_admin_key(client):
    missing = await client.get("/admin/providers")
    assert missing.status_code == 401
    wrong = await client.get("/admin/providers", headers={"Authorization": "Bearer no"})
    assert wrong.status_code == 401


async def test_usage_summary_is_empty(client):
    response = await client.get("/admin/usage/summary", headers=ADMIN)
    assert response.status_code == 200
    body = response.json()
    assert body["requests"] == 0
    assert body["avg_latency_ms"] is None
    assert body["tokens_by_app"] == []
    assert body["cost_by_model"] == []
    assert body["recent"] == []


async def test_provider_and_model_crud(client):
    adapters = await client.get("/admin/adapters", headers=ADMIN)
    slugs = {item["slug"]: item["implemented"] for item in adapters.json()["adapters"]}
    assert slugs["openai"] is True
    assert slugs["anthropic"] is True
    assert slugs["ollama"] is True
    assert slugs["groq"] is False
    assert slugs["gemini"] is False
    assert slugs["deepseek"] is False
    assert slugs["together"] is False
    assert slugs["vllm"] is False

    provider = await create_provider(client, name="vps", adapter="openai", base_url="http://10.0.0.8:8001/v1")
    model = await create_model(client, provider["id"], name="llama3.2-3b", alias="local-llama")
    disabled = await client.patch(
        f"/admin/models/{model['id']}",
        json={"enabled": False, "alias": "renamed", "input_per_million": 1.5},
        headers=ADMIN,
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False
    assert disabled.json()["alias"] == "renamed"
    assert disabled.json()["public_id"] == "vps/llama3.2-3b"
    assert disabled.json()["input_per_million"] == 1.5

    removed = await client.delete(f"/admin/providers/{provider['id']}", headers=ADMIN)
    assert removed.status_code == 204
    listing = await client.get("/admin/models", headers=ADMIN)
    assert listing.json() == []
