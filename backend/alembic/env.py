from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.database import Base  # noqa: E402
from app import models  # noqa: F401,E402


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        file_path = os.getenv("DATABASE_URL_FILE", "").strip()
        if file_path:
            url = Path(file_path).read_text(encoding="utf-8").strip()
    if not url:
        url = config.get_main_option("sqlalchemy.url")
    allow_sqlite_legacy = os.getenv("ALLOW_SQLITE_LEGACY", "false").lower() in {"1", "true", "yes", "on"}
    if url.startswith("sqlite") and not allow_sqlite_legacy:
        raise RuntimeError(
            "SQLite ya no es un motor soportado para migraciones. "
            "Configura DATABASE_URL con PostgreSQL. "
            "Solo para leer bases antiguas: ALLOW_SQLITE_LEGACY=true."
        )
    if url == "sqlite+aiosqlite:///./treseko_db.db":
        db_path = (BACKEND_DIR / "treseko_db.db").as_posix()
        return f"sqlite+aiosqlite:///{db_path}"
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=connection.dialect.name == "sqlite",
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = database_url()
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
