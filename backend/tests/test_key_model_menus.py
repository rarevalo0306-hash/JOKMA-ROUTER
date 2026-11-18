import json
from uuid import uuid4

import httpx
import pytest

from tests.conftest import ADMIN, create_key, create_model, create_provider, install_mock
from tests.test_gateway import anthropic_sse, chat, openai_sse


async def restricted_key(client, name, models):
    response = await client.post(
        "/admin/api-keys",
        headers=ADMIN,
        json={"name": name, "model_ids": [model["id"] for model in models]},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def set_menu(client, key, model_ids):
    return await client.patch(
        f"/admin/api-keys/{key['id']}", headers=ADMIN, json={"model_ids": model_ids},
    )


def bearer(key):
    return {"Authorization": f"Bearer {key['raw_key']}"}


async def visible_models(client, key):
    response = await client.get("/v1/models", headers=bearer(key))
    assert response.status_code == 200, response.text
    return [model["id"] for model in response.json()["data"]]


async def complete(client, key, model):
    return await client.post(
        "/v1/chat/completions", headers=bearer(key), json=chat(model, stream=False),
    )


async def test_custom_menu_routes_across_providers_and_isolates_apps(app, client):
    openai = await create_provider(client)
    anthropic = await create_provider(
        client, name="anthropic", adapter="anthropic", base_url="https://anthropic.example",
    )
    google = await create_provider(
        client, name="google", adapter="gemini", base_url="https://google.example/v1",
    )
    selected = [
        await create_model(client, openai["id"], name="gpt-4.1", alias="writer"),
        await create_model(client, openai["id"], name="gpt-4o-mini"),
        await create_model(client, anthropic["id"], name="claude-sonnet"),
        await create_model(client, google["id"], name="gemini-flash"),
    ]
    private = await create_model(client, google["id"], name="gemini-pro", alias="private-alias")
    editor = await restricted_key(client, "editor", selected)
    reviewer = await restricted_key(client, "reviewer", [private])
    expected = [model["public_id"] for model in selected]
    assert sorted(await visible_models(client, editor)) == sorted(expected)
    assert await visible_models(client, reviewer) == [private["public_id"]]

    upstream_models = []

    def respond(request):
        model = json.loads(request.content)["model"]
        upstream_models.append(model)
        content = anthropic_sse(model) if request.url.host == "anthropic.example" else openai_sse(model)
        return httpx.Response(200, content=content)

    await install_mock(app, respond)
    for model in selected:
        response = await complete(client, editor, model["public_id"])
        assert response.status_code == 200, response.text
        assert response.json()["choices"][0]["message"]["content"] == model["name"]
    alias = await complete(client, editor, "writer")
    assert alias.status_code == 200
    assert alias.headers["x-jokma-model-served"] == selected[0]["public_id"]
    for key, forbidden in [(editor, private["public_id"]), (editor, "private-alias"), (reviewer, "writer")]:
        assert (await complete(client, key, forbidden)).status_code in (403, 404)
    assert upstream_models == [model["name"] for model in selected] + [selected[0]["name"]]


async def test_edit_menu_keeps_token_empty_and_unrestricted_have_distinct_effects(app, client):
    provider = await create_provider(client)
    first = await create_model(client, provider["id"], name="alpha", alias="first")
    second = await create_model(client, provider["id"], name="beta")
    legacy = await create_key(client)
    all_ids = {first["public_id"], "first", second["public_id"]}
    assert set(await visible_models(client, legacy)) == all_ids

    await install_mock(app, lambda _: pytest.fail("A key with an empty menu reached a provider"))
    key = await restricted_key(client, "editor", [])
    assert await visible_models(client, key) == []
    for model in [first, second]:
        updated = await set_menu(client, key, [model["id"]])
        assert updated.status_code == 200, updated.text
        assert "raw_key" not in updated.json()
        assert await visible_models(client, key) == [model["public_id"]]
    assert (await set_menu(client, key, [])).status_code == 200
    assert await visible_models(client, key) == []
    assert (await complete(client, key, second["public_id"])).status_code in (403, 404)
    assert (await set_menu(client, key, None)).status_code == 200
    assert set(await visible_models(client, key)) == all_ids
    assert set(await visible_models(client, legacy)) == all_ids


async def test_fallback_skips_unlisted_models_and_refuses_when_none_permitted(app, client):
    provider = await create_provider(client)
    blocked = await create_model(client, provider["id"], name="blocked")
    allowed = await create_model(client, provider["id"], name="allowed")
    primary = await create_model(
        client, provider["id"], name="primary", alias="auto",
        fallback_model_ids=[blocked["id"], allowed["id"]],
    )
    key = await restricted_key(client, "writer", [primary, allowed])
    called = []

    def respond(request):
        model = json.loads(request.content)["model"]
        called.append(model)
        if model == "primary":
            return httpx.Response(429, json={"error": "rate limit"})
        return httpx.Response(200, content=openai_sse(model))

    await install_mock(app, respond)
    result = await complete(client, key, "auto")
    assert result.status_code == 200, result.text
    assert result.headers["x-jokma-model-served"] == allowed["public_id"]
    assert result.headers["x-jokma-fallback"] == "true"
    assert called == ["primary", "allowed"]
    assert (await set_menu(client, key, [primary["id"]])).status_code == 200
    called.clear()
    assert (await complete(client, key, "auto")).status_code == 429
    assert called == ["primary"]


async def test_bad_ids_roll_back_key_creation_and_existing_menu(client):
    provider = await create_provider(client)
    original = await create_model(client, provider["id"], name="original")
    other = await create_model(client, provider["id"], name="other")
    key = await restricted_key(client, "billing", [original])
    for unknown in ["malformed", str(uuid4())]:
        invalid_ids = [other["id"], unknown]
        created = await client.post(
            "/admin/api-keys", headers=ADMIN, json={"name": "invalid", "model_ids": invalid_ids},
        )
        assert 400 <= created.status_code < 500
        assert 400 <= (await set_menu(client, key, invalid_ids)).status_code < 500
        assert await visible_models(client, key) == [original["public_id"]]
    listed = (await client.get("/admin/api-keys", headers=ADMIN)).json()
    assert [row["id"] for row in listed] == [key["id"]]
    assert listed[0]["model_ids"] == [original["id"]]


async def test_disabling_deleting_or_recreating_model_cannot_expand_an_app_menu(app, client):
    provider = await create_provider(client)
    selected = await create_model(client, provider["id"], name="chosen", alias="alias")
    await create_model(client, provider["id"], name="other")
    await install_mock(app, lambda _: pytest.fail("A disabled or unlisted model reached a provider"))
    key = await restricted_key(client, "limited", [selected])
    path = f"/admin/models/{selected['id']}"
    provider_path = f"/admin/providers/{provider['id']}"
    for resource in [path, provider_path]:
        assert (await client.patch(resource, headers=ADMIN, json={"enabled": False})).status_code == 200
        assert await visible_models(client, key) == []
        assert (await complete(client, key, "alias")).status_code == 404
        assert (await client.patch(resource, headers=ADMIN, json={"enabled": True})).status_code == 200
        assert await visible_models(client, key) == [selected["public_id"]]

    assert (await client.delete(path, headers=ADMIN)).status_code == 204
    await create_model(client, provider["id"], name="chosen", alias="alias")
    assert await visible_models(client, key) == []
    for old_ref in ["alias", selected["public_id"]]:
        assert (await complete(client, key, old_ref)).status_code in (403, 404)
