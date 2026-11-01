"""Apply SQL files in supabase/migrations once.

The runner records filenames in jokma_schema_migrations. It does not talk to a
hosted Supabase project unless DATABASE_URL points there on purpose.
"""

import asyncio
import os
import re
from pathlib import Path

import asyncpg

from app.config import get_settings


def migrations_dir() -> Path:
    override = os.environ.get("MIGRATIONS_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    repo = here.parents[2] / "supabase" / "migrations"
    if repo.is_dir():
        return repo
    return here.parents[1] / "migrations"


def to_asyncpg_dsn(database_url: str) -> str:
    return (
        database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        .replace("postgres+asyncpg://", "postgresql://", 1)
    )


def split_sql(script: str) -> list[str]:
    """Split a script on semicolons, keeping dollar-quoted bodies intact."""
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    length = len(script)
    dollar: str | None = None
    in_single = False
    while i < length:
        if dollar is not None:
            if script.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(script[i])
            i += 1
            continue
        if in_single:
            buf.append(script[i])
            if script[i] == "'":
                if i + 1 < length and script[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if script[i] == "'":
            in_single = True
            buf.append("'")
            i += 1
            continue
        if script[i] == "$":
            match = re.match(r"\$[A-Za-z0-9_]*\$", script[i:])
            if match:
                dollar = match.group(0)
                buf.append(dollar)
                i += len(dollar)
                continue
        if script[i] == "-" and i + 1 < length and script[i + 1] == "-":
            newline = script.find("\n", i)
            i = length if newline == -1 else newline
            continue
        if script[i] == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue
        buf.append(script[i])
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


async def apply_migrations(database_url: str, directory: Path | None = None) -> list[str]:
    directory = directory or migrations_dir()
    files = sorted(path for path in directory.glob("*.sql") if path.is_file())
    connection = await asyncpg.connect(to_asyncpg_dsn(database_url))
    applied: list[str] = []
    try:
        await connection.execute(
            """
            create table if not exists jokma_schema_migrations (
                filename text primary key,
                applied_at timestamptz not null default now()
            )
            """
        )
        for path in files:
            existing = await connection.fetchrow(
                "select filename from jokma_schema_migrations where filename = $1",
                path.name,
            )
            if existing:
                continue
            async with connection.transaction():
                for statement in split_sql(path.read_text()):
                    await connection.execute(statement)
                await connection.execute(
                    "insert into jokma_schema_migrations (filename) values ($1)",
                    path.name,
                )
            applied.append(path.name)
    finally:
        await connection.close()
    return applied


def main() -> None:
    settings = get_settings()
    applied = asyncio.run(apply_migrations(settings.database_url))
    if applied:
        print("applied:", ", ".join(applied))
    else:
        print("migrations already applied")


if __name__ == "__main__":
    main()
