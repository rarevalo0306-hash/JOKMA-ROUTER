import httpx
import pytest

from tests.conftest import ADMIN, create_provider, install_mock


@pytest.mark.parametrize(
    ("adapter", "base", "path", "rows", "header"),
    [
        ("openai", "https://models.example/v1", "/v1/models", {"data": [{"id": "org/model"}]}, "authorization"),
        ("ollama", "http://local.example/api", "/api/tags", {"models": [{"name": "org/model"}]}, "authorization"),
        ("anthropic", "https://claude.example/v1", "/v1/models", {"data": [{"id": "org/model"}]}, "x-api-key"),
    ],
)
async def test_discovery_uses_configured_endpoint_and_stored_key(client, app, adapter, base, path, rows, header):
    provider = await create_provider(client, adapter=adapter, base_url=base, api_key="test-secret")
    calls = []

    async def handler(request):
        calls.append(request)
        return httpx.Response(200, json=rows)

    await install_mock(app, handler)
    route = f"/admin/providers/{provider['id']}/models"
    assert (await client.get(route)).status_code == 401
    response = await client.get(route, headers=ADMIN)
    assert response.json() == {"models": ["org/model"]}
    assert len(calls) == 1
    assert calls[0].url.path == path
    assert calls[0].headers[header] == ("test-secret" if adapter == "anthropic" else "Bearer test-secret")


async def test_discovery_distinguishes_empty_and_unavailable_catalogs(client, app):
    provider = await create_provider(client)
    results = iter([httpx.Response(200, json={"data": []}), httpx.Response(401, text="sk-test"), httpx.Response(200, json={})])

    async def handler(_request):
        return next(results)

    await install_mock(app, handler)
    route = f"/admin/providers/{provider['id']}/models"
    assert (await client.get(route, headers=ADMIN)).json() == {"models": []}
    refused = await client.get(route, headers=ADMIN)
    assert refused.status_code == 502
    assert "401" in refused.text and "sk-test" not in refused.text
    assert (await client.get(route, headers=ADMIN)).status_code == 502


async def test_discovery_follows_anthropic_pages_and_keeps_catalog_read_only(client, app):
    provider = await create_provider(client, adapter="anthropic", base_url="https://models.example")
    pages = []

    async def handler(request):
        pages.append(request.url.params.get("after_id"))
        if pages == [None]:
            return httpx.Response(200, json={"data": [{"id": "beta"}], "has_more": True, "last_id": "beta"})
        return httpx.Response(200, json={"data": [{"id": "alpha"}], "has_more": False})

    await install_mock(app, handler)
    response = await client.get(f"/admin/providers/{provider['id']}/models", headers=ADMIN)
    assert response.json() == {"models": ["alpha", "beta"]}
    assert pages == [None, "beta"]
    assert (await client.get("/admin/models", headers=ADMIN)).json() == []
