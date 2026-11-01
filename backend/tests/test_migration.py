import uuid

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
        assert applied == [SQL.name]
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
