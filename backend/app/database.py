import logging
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from .database_legacy_sqlite_automation import migrate_automation_schema
from .database_legacy_sqlite_core import migrate_identity_and_project_schema
from .database_legacy_sqlite_testing import migrate_testing_execution_schema


logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parent.parent

APP_ENV = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower()
IS_PRODUCTION = APP_ENV in {"production", "prod"}

if not IS_PRODUCTION:
    load_dotenv(BACKEND_DIR / ".env")


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or raw_value == "":
        return default
    try:
        return int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} debe ser un entero") from exc


def _env_or_file(name: str) -> str:
    direct_value = (os.getenv(name) or "").strip()
    if direct_value:
        return direct_value
    file_path = (os.getenv(f"{name}_FILE") or "").strip()
    if not file_path:
        return ""
    try:
        return Path(file_path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"No se pudo leer {name}_FILE={file_path}") from exc


DATABASE_URL = _env_or_file("DATABASE_URL")
if not DATABASE_URL:
    if IS_PRODUCTION:
        raise RuntimeError("DATABASE_URL es obligatorio cuando APP_ENV=production.")
    DATABASE_URL = "postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db"

DB_ECHO = os.getenv("DB_ECHO", "false").lower() in {"1", "true", "yes", "on"}
ALLOW_SQLITE_LEGACY = os.getenv("ALLOW_SQLITE_LEGACY", "false").lower() in {"1", "true", "yes", "on"}
ALLOW_SCHEMA_CREATE_ALL = (
    os.getenv("TRESEKO_ALLOW_SCHEMA_CREATE_ALL", "false" if IS_PRODUCTION else "true").lower()
    in {"1", "true", "yes", "on"}
)
DB_POOL_SIZE = _env_int("DB_POOL_SIZE", 5)
DB_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 10)
DB_POOL_RECYCLE = _env_int("DB_POOL_RECYCLE", 1800)
DB_POOL_TIMEOUT = _env_int("DB_POOL_TIMEOUT", 30)

if DATABASE_URL.startswith("sqlite"):
    if not ALLOW_SQLITE_LEGACY:
        raise RuntimeError(
            "SQLite ya no es un motor soportado para la aplicacion. "
            "Configura DATABASE_URL con PostgreSQL. "
            "Solo para leer bases antiguas: ALLOW_SQLITE_LEGACY=true."
        )
    if DATABASE_URL == "sqlite+aiosqlite:///./treseko_db.db":
        sqlite_path = (BACKEND_DIR / "treseko_db.db").as_posix()
        DATABASE_URL = f"sqlite+aiosqlite:///{sqlite_path}"

def _redact_database_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "[invalid database url]"
    if not parsed.password:
        return url
    username = parsed.username or ""
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    auth = f"{username}:***@" if username else "***@"
    return urlunsplit((parsed.scheme, f"{auth}{host}{port}", parsed.path, parsed.query, parsed.fragment))


def _log_database_startup(database_url: str = DATABASE_URL, backend_dir: Path = BACKEND_DIR) -> None:
    logger.info("Using DATABASE_URL: %s", _redact_database_url(database_url))
    logger.debug("Backend dir: %s", backend_dir)


_log_database_startup()

_engine_kwargs = {
    "echo": DB_ECHO,
    "pool_pre_ping": True,
}
if not DATABASE_URL.startswith("sqlite"):
    _engine_kwargs.update({
        "pool_size": DB_POOL_SIZE,
        "max_overflow": DB_MAX_OVERFLOW,
        "pool_recycle": DB_POOL_RECYCLE,
        "pool_timeout": DB_POOL_TIMEOUT,
    })

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def migrate_sqlite_dev_schema():
    """Migraciones defensivas legacy para SQLite local. PostgreSQL usa Alembic."""
    if engine.dialect.name != "sqlite":
        return

    async with engine.begin() as conn:

        def get_columns(sync_conn, table_name):
            inspector = inspect(sync_conn)
            if not inspector.has_table(table_name):
                return set()
            return {column["name"] for column in inspector.get_columns(table_name)}

        def get_column_info(sync_conn, table_name):
            inspector = inspect(sync_conn)
            if not inspector.has_table(table_name):
                return []
            return inspector.get_columns(table_name)

        phase_args = (conn, get_columns, get_column_info, BACKEND_DIR)
        await migrate_identity_and_project_schema(*phase_args)
        await migrate_testing_execution_schema(*phase_args)
        await migrate_automation_schema(*phase_args)


async def initialize_database():
    if ALLOW_SCHEMA_CREATE_ALL:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        logger.info("Schema create_all deshabilitado; usa Alembic para aplicar migraciones.")
    await migrate_sqlite_dev_schema()
