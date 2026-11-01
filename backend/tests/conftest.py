import httpx
import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app
from app.orm import Base

ADMIN = {"Authorization": "Bearer test-admin-key"}


@pytest.fixture
async def app(tmp_path):
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path}/test.db",
        router_secret_key=Fernet.generate_key().decode(),
        admin_api_key="test-admin-key",
        request_timeout_seconds=5,
        cors_origins="http://localhost:3000",
    )
    application = create_app(settings)
    async with application.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield application
    await application.state.http.aclose()
    await application.state.engine.dispose()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def install_mock(app, handler):
    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def create_provider(client, **overrides):
    payload = {
        "name": "openai",
        "adapter": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-test",
        "enabled": True,
    }
    payload.update(overrides)
    response = await client.post("/admin/providers", json=payload, headers=ADMIN)
    assert response.status_code == 201, response.text
    return response.json()


async def create_model(client, provider_id, **overrides):
    payload = {
        "provider_id": provider_id,
        "name": "gpt-4o",
        "alias": None,
        "enabled": True,
        "fallback_model_ids": [],
        "input_per_million": 0,
        "output_per_million": 0,
    }
    payload.update(overrides)
    response = await client.post("/admin/models", json=payload, headers=ADMIN)
    assert response.status_code == 201, response.text
    return response.json()


async def create_key(client, app_name="billing", name=None):
    response = await client.post(
        "/admin/api-keys",
        json={"name": name or app_name, "app_name": app_name},
        headers=ADMIN,
    )
    assert response.status_code == 201, response.text
    return response.json()
