import asyncio

from tests.conftest import ADMIN, create_model, create_provider


async def test_explicit_transfer_requires_the_current_source_and_target_alias(client):
    provider = await create_provider(client)
    source = await create_model(client, provider["id"], name="one", alias="assistant")
    target = await create_model(client, provider["id"], name="two", alias="other")
    patch = f"/admin/models/{target['id']}"
    transfer = {"alias": "assistant", "expected_alias": "other", "transfer_alias_from": source["id"]}

    conflict = await client.patch(patch, headers=ADMIN, json={"alias": "assistant"})
    assert conflict.status_code == 409
    stale = await client.patch(patch, headers=ADMIN, json={**transfer, "expected_alias": None})
    assert stale.status_code == 409
    invalid = await client.patch(patch, headers=ADMIN, json={**transfer, "fallback_model_ids": [target["id"]]})
    assert invalid.status_code == 400
    before = (await client.get("/admin/models", headers=ADMIN)).json()
    assert {m["name"]: m["alias"] for m in before} == {"one": "assistant", "two": "other"}

    moved = await client.patch(patch, headers=ADMIN, json=transfer)
    assert moved.status_code == 200, moved.text
    assert moved.json()["alias"] == "assistant"
    after = (await client.get("/admin/models", headers=ADMIN)).json()
    assert {m["name"]: m["alias"] for m in after} == {"one": None, "two": "assistant"}


async def test_two_transfers_cannot_both_take_the_same_alias(client):
    provider = await create_provider(client)
    source = await create_model(client, provider["id"], name="one", alias="assistant")
    first = await create_model(client, provider["id"], name="two")
    second = await create_model(client, provider["id"], name="three")
    transfer = {"alias": "assistant", "expected_alias": None, "transfer_alias_from": source["id"]}
    outcomes = await asyncio.gather(*(
        client.patch(f"/admin/models/{model['id']}", headers=ADMIN, json=transfer)
        for model in (first, second)
    ))
    assert sorted(response.status_code for response in outcomes) == [200, 409]
    models = (await client.get("/admin/models", headers=ADMIN)).json()
    winner = next(response.json()["id"] for response in outcomes if response.status_code == 200)
    assert [m["id"] for m in models if m["alias"] == "assistant"] == [winner]
