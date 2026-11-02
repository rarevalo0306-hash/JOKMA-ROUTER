import uuid
from decimal import Decimal

import asyncpg
import pytest

from app.migrate import apply_migrations, split_sql
from pathlib import Path


SQL = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20261101043500_init_gateway.sql"


def test_sql_splitter_keeps_the_rls_block_intact():
    statements = split_sql(SQL.read_text())
    do_blocks = [item for item in statements if item.lower().startswith("do ")]
    assert len(do_blocks) == 1
    assert "revoke all privileges" in do_blocks[0]
    assert "from anon" in do_blocks[0]
    assert "from authenticated" in do_blocks[0]
    joined = "\n".join(statements).lower()
    for name in (
        "providers",
        "models",
        "model_fallbacks",
        "model_prices",
        "api_keys",
        "usage_logs",
    ):
        assert f"create table if not exists {name}" in joined
    for index in (
        "ix_usage_logs_app_created",
        "ix_usage_logs_key_created",
        "ix_usage_logs_model_served_created",
        "ix_usage_logs_model_requested_created",
        "ix_usage_logs_created",
    ):
        assert index in joined
    assert "enable row level security" in joined
    assert "api_key_encrypted" in joined


async def test_migration_applies_on_postgres():
    name = f"jokma_{uuid.uuid4().hex[:10]}"
    try:
        admin = await asyncpg.connect(user="ubuntu", database="postgres", host="/var/run/postgresql")
    except Exception as exc:
        pytest.skip(f"local postgres is not available: {exc}")
    await admin.execute(f'create database "{name}"')
    await admin.close()
    url = f"postgresql://ubuntu@/{name}?host=/var/run/postgresql"
    try:
        applied = await apply_migrations(url, SQL.parent)
        assert applied == [
            "20261101043500_init_gateway.sql",
            "20261102003400_current_chat_models.sql",
            "20261102031500_provider_key_presets.sql",
            "20261102061200_openrouter_and_model_slashes.sql",
        ]
        again = await apply_migrations(url, SQL.parent)
        assert again == []
        connection = await asyncpg.connect(user="ubuntu", database=name, host="/var/run/postgresql")
        tables = {
            row["tablename"]
            for row in await connection.fetch(
                "select tablename from pg_tables where schemaname = 'public'"
            )
        }
        assert {
            "providers",
            "models",
            "model_fallbacks",
            "model_prices",
            "api_keys",
            "usage_logs",
        } <= tables
        rls = await connection.fetchval(
            "select relrowsecurity from pg_class where relname = 'usage_logs'"
        )
        assert rls is True
        indexes = {
            row["indexname"]
            for row in await connection.fetch(
                "select indexname from pg_indexes where tablename = 'usage_logs'"
            )
        }
        assert "ix_usage_logs_app_created" in indexes
        assert "ix_usage_logs_key_created" in indexes
        assert "ix_usage_logs_model_served_created" in indexes
        public_id = await connection.fetchval(
            """
            select providers.name || '/' || models.name
            from models
            join providers on providers.id = models.provider_id
            where models.alias = 'local-llama'
            """
        )
        assert public_id == "local/llama3.2-3b"
        catalog = {
            row["public_id"]: (row["enabled"], row["input_per_million"], row["output_per_million"])
            for row in await connection.fetch(
                """
                select providers.name || '/' || models.name as public_id,
                       models.enabled,
                       model_prices.input_per_million,
                       model_prices.output_per_million
                from models
                join providers on providers.id = models.provider_id
                join model_prices on model_prices.model_id = models.id
                where providers.name in ('openai', 'anthropic')
                """
            )
        }
        expected = {
            "openai/gpt-6-astra": (True, 10, 50),
            "openai/gpt-6.1-sol": (True, 2, 10),
            "openai/gpt-6.1-terra": (True, 1, 5),
            "openai/gpt-6-luna": (True, Decimal("0.10"), Decimal("0.50")),
            "openai/gpt-4.1": (True, 2, 8),
            "openai/o3": (True, 2, 8),
            "openai/gpt-4o": (True, Decimal("2.5"), 10),
            "anthropic/claude-fable-5-1": (True, 10, 50),
            "anthropic/claude-opus-5-5": (True, 4, 20),
            "anthropic/claude-sonnet-5-5": (True, 2, 10),
            "anthropic/claude-haiku-5-5": (True, Decimal("0.10"), Decimal("0.50")),
            "anthropic/claude-sonnet-4-5": (True, 3, 15),
        }
        def money(value):
            return Decimal(value).quantize(Decimal("0.000001"))

        for public_id, (enabled, inp, out) in expected.items():
            got_enabled, got_in, got_out = catalog[public_id]
            assert got_enabled is enabled
            assert money(got_in) == money(inp)
            assert money(got_out) == money(out)
        assert "anthropic/claude-opus-4-1" not in catalog
        assert await connection.fetchval("select enabled from providers where name = 'openai'") is False
        presets = {
            row["name"]: row
            for row in await connection.fetch(
                """
                select name, adapter, base_url, key_url, label, kind, enabled,
                       api_key_encrypted is null as key_empty
                from providers
                """
            )
        }
        assert presets["openai"]["key_url"] == "https://platform.openai.com/api-keys"
        assert presets["openai"]["label"] == "OpenAI"
        assert presets["anthropic"]["key_url"] == "https://console.anthropic.com/settings/keys"
        assert presets["anthropic"]["adapter"] == "anthropic"
        assert presets["local"]["key_url"] is None
        chat = {
            "gemini": ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "https://aistudio.google.com/apikey"),
            "groq": ("openai", "https://api.groq.com/openai/v1", "https://console.groq.com/keys"),
            "deepseek": ("openai", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys"),
            "together": ("openai", "https://api.together.xyz/v1", "https://api.together.ai/settings/api-keys"),
            "mistral": ("openai", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys"),
            "dashscope": ("openai", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://modelstudio.console.alibabacloud.com/"),
            "openrouter": ("openai", "https://openrouter.ai/api/v1", "https://openrouter.ai/keys"),
        }
        for name, (adapter, base_url, key_url) in chat.items():
            row = presets[name]
            assert row["adapter"] == adapter
            assert row["base_url"] == base_url
            assert row["key_url"] == key_url
            assert row["kind"] == "chat"
            assert row["enabled"] is True
            assert row["key_empty"] is True
        video = {
            "veo": "https://aistudio.google.com/apikey",
            "sora": "https://platform.openai.com/api-keys",
            "runway": "https://dev.runwayml.com/",
            "kling": "https://klingai.com/dev",
            "luma": "https://lumalabs.ai/dream-machine/api",
            "pika": "https://pika.art/",
            "fal": "https://fal.ai/dashboard/keys",
            "hailuo": "https://www.minimax.io/",
        }
        for name, key_url in video.items():
            row = presets[name]
            assert row["adapter"] == "video"
            assert row["kind"] == "video"
            assert row["enabled"] is False
            assert row["key_url"] == key_url
            assert row["key_empty"] is True
        assert await connection.fetchval("select count(*) from providers where name = 'openai'") == 1
        await connection.execute(
            "update providers set api_key_encrypted = 'keep-me', enabled = false where name = 'groq'"
        )
        for statement in split_sql((SQL.parent / "20261102031500_provider_key_presets.sql").read_text()):
            await connection.execute(statement)
        kept = await connection.fetchrow(
            "select api_key_encrypted, enabled from providers where name = 'groq'"
        )
        assert kept["api_key_encrypted"] == "keep-me"
        assert kept["enabled"] is False
        assert presets["openrouter"]["label"] == "OpenRouter"
        await connection.execute(
            """
            insert into models (provider_id, name, enabled)
            select id, 'openai/gpt-4o', true from providers where name = 'openrouter'
            """
        )
        for bad_name in ("openai/", "/gpt-4o", "openai//gpt-4o", "a b"):
            with pytest.raises(asyncpg.CheckViolationError):
                async with connection.transaction():
                    await connection.execute(
                        """
                        insert into models (provider_id, name, enabled)
                        select id, $1, true from providers where name = 'openrouter'
                        """,
                        bad_name,
                    )
        await connection.execute(
            "update providers set api_key_encrypted = 'keep-or', enabled = false where name = 'openrouter'"
        )
        for statement in split_sql((SQL.parent / "20261102061200_openrouter_and_model_slashes.sql").read_text()):
            await connection.execute(statement)
        kept_router = await connection.fetchrow(
            "select api_key_encrypted, enabled, base_url from providers where name = 'openrouter'"
        )
        assert kept_router["api_key_encrypted"] == "keep-or"
        assert kept_router["enabled"] is False
        assert kept_router["base_url"] == "https://openrouter.ai/api/v1"
        assert await connection.fetchval("select count(*) from providers where name = 'openrouter'") == 1
        comment = await connection.fetchval(
            """
            select col_description('providers'::regclass, attnum)
            from pg_attribute
            where attrelid = 'providers'::regclass and attname = 'api_key_encrypted'
            """
        )
        assert "Fernet" in comment
        await connection.close()
    finally:
        admin = await asyncpg.connect(user="ubuntu", database="postgres", host="/var/run/postgresql")
        await admin.execute(f'drop database if exists "{name}"')
        await admin.close()
