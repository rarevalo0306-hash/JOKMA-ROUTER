import os
from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, StaticPool

from app.config import Settings

# libpq query keys asyncpg does not accept as connect() kwargs.
_LIBPQ_ONLY = ("sslmode", "channel_binding", "sslrootcert", "sslcert", "sslkey")
_SSL_ON = {"require", "verify-ca", "verify-full", "true", "1", "on"}


def engine_options(database_url: str, *, serverless: bool | None = None) -> tuple[str, dict, dict]:
    """Return a SQLAlchemy URL plus connect/engine kwargs.

    Hosted Postgres URLs often carry libpq's ``sslmode``. asyncpg rejects that
    keyword, so it is translated to ``ssl=True``. On Vercel each instance is
    short-lived, so the engine uses a null pool. Pooler hosts (Neon, Supabase
    transaction mode) also disable asyncpg's prepared-statement cache.
    """
    connect_args: dict = {}
    engine_kwargs: dict = {}
    if serverless is None:
        serverless = bool(os.environ.get("VERCEL"))

    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if ":memory:" in database_url:
            engine_kwargs["poolclass"] = StaticPool
        return database_url, connect_args, engine_kwargs

    parsed = make_url(database_url)
    query = dict(parsed.query)
    sslmode = str(query.get("sslmode", "") or "")
    ssl_flag = str(query.get("ssl", "") or "")
    for key in _LIBPQ_ONLY:
        query.pop(key, None)
    # ``ssl`` as a URL query is also not an asyncpg DSN parameter.
    query.pop("ssl", None)
    if sslmode.lower() in _SSL_ON or ssl_flag.lower() in _SSL_ON:
        connect_args["ssl"] = True
    elif sslmode.lower() == "disable":
        connect_args["ssl"] = False

    host = (parsed.host or "").lower()
    port = parsed.port
    pooled = "pooler" in host or port == 6543
    if serverless:
        engine_kwargs["poolclass"] = NullPool
        engine_kwargs["pool_pre_ping"] = True
    if serverless or pooled:
        connect_args["statement_cache_size"] = 0

    parsed = parsed.set(query=query)
    return parsed.render_as_string(hide_password=False), connect_args, engine_kwargs


def create_engine(database_url: str):
    url, connect_args, engine_kwargs = engine_options(database_url)
    engine = create_async_engine(url, connect_args=connect_args, **engine_kwargs)
    if database_url.startswith("sqlite"):
        from sqlalchemy import event

        @event.listens_for(engine.sync_engine, "connect")
        def _enable_sqlite_fks(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def create_sessionmaker(engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    sessionmaker = request.app.state.sessionmaker
    async with sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def bind_database(app, settings: Settings) -> None:
    engine = create_engine(settings.database_url)
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)
