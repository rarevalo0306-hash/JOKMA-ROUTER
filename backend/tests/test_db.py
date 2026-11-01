from sqlalchemy.pool import NullPool, StaticPool

from app.db import engine_options


def test_sqlite_memory_uses_static_pool():
    _url, args, kwargs = engine_options("sqlite+aiosqlite:///:memory:", serverless=False)
    assert kwargs["poolclass"] is StaticPool
    assert args["check_same_thread"] is False


def test_hosted_postgres_translates_sslmode_for_asyncpg():
    url, args, kwargs = engine_options(
        "postgresql+asyncpg://user:secret@ep-x-pooler.us-east-1.aws.neon.tech/jokma"
        "?sslmode=require&channel_binding=require",
        serverless=True,
    )
    assert "sslmode" not in url
    assert "channel_binding" not in url
    assert "ep-x-pooler.us-east-1.aws.neon.tech" in url
    assert args["ssl"] is True
    assert args["statement_cache_size"] == 0
    assert kwargs["poolclass"] is NullPool


def test_local_postgres_keeps_the_default_pool():
    url, args, kwargs = engine_options(
        "postgresql+asyncpg://jokma:jokma@localhost:5432/jokma",
        serverless=False,
    )
    assert url.startswith("postgresql+asyncpg://")
    assert "poolclass" not in kwargs
    assert "statement_cache_size" not in args
    assert "ssl" not in args
