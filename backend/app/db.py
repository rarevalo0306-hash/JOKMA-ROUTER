from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings


def create_engine(database_url: str):
    connect_args: dict = {}
    engine_kwargs: dict = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        # Shared cache so the migration-less test database is one database.
        if ":memory:" in database_url:
            engine_kwargs["poolclass"] = StaticPool
    engine = create_async_engine(database_url, connect_args=connect_args, **engine_kwargs)
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
